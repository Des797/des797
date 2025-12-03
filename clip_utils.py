# ==========================================
# FILE: clip_utils.py
# ==========================================
import clip
import torch
from PIL import Image
import io
from config import CLIP_MODEL, DEVICE


# =====================================================
# CLIP MANAGER
# =====================================================
class CLIPManager:
    """
    Manages CLIP model, text embeddings, and image similarity search.

    Safely handles:
      - empty tag sets
      - dynamic addition of tags
      - GPU memory (half precision, batching)
      - corrupted images
      - tags added before initialization
    """

    def __init__(self):
        self.device = DEVICE

        # Load CLIP model
        self.model, self.preprocess = clip.load(CLIP_MODEL, device=self.device)
        self.model.eval()
        self.model = self.model.half()  # reduce VRAM usage

        # Embedding storage
        self.tag_embeddings = {}        # tag -> tensor
        self.tag_list_ordered = []      # list of tags in same order as matrix
        self.tag_embedding_matrix = None  # single stacked tensor

    # -------------------------------------------------
    # Internal — safe normalization
    # -------------------------------------------------
    @staticmethod
    def _normalize(tensor):
        return tensor / tensor.norm(dim=-1, keepdim=True).clamp(min=1e-12)

    # -------------------------------------------------
    # Precompute embeddings for a list of text tags
    # -------------------------------------------------
    def precompute_tag_embeddings(self, tags_list, batch_size=256):
        """
        Compute CLIP text embeddings for a list of tags.
        Returns: dict(tag -> embedding tensor)
        """
        if not tags_list:
            return {}

        embeddings = {}

        with torch.no_grad():
            for i in range(0, len(tags_list), batch_size):
                batch = tags_list[i:i + batch_size]
                tokens = clip.tokenize(batch).to(self.device)

                # Text → embedding
                emb = self.model.encode_text(tokens.half())
                emb = self._normalize(emb)

                for t, e in zip(batch, emb):
                    embeddings[t] = e

        return embeddings

    # -------------------------------------------------
    # Initialize all tag embeddings
    # -------------------------------------------------
    def initialize_tags(self, unique_tags):
        """
        Build initial tag embedding matrix. Safe against empty lists.
        """
        if not unique_tags:
            print("[CLIP] No tags provided. Initialized empty tag set.")
            self.tag_embeddings = {}
            self.tag_list_ordered = []
            self.tag_embedding_matrix = None
            return

        # Compute embeddings
        self.tag_embeddings = self.precompute_tag_embeddings(unique_tags)
        self.tag_list_ordered = list(self.tag_embeddings.keys())

        if not self.tag_list_ordered:
            print("[CLIP] Tag list was provided but produced no embeddings.")
            self.tag_embedding_matrix = None
            return

        # Build matrix
        self.tag_embedding_matrix = torch.stack(
            [self.tag_embeddings[t] for t in self.tag_list_ordered]
        )

        print(f"[CLIP] Loaded {len(self.tag_embeddings)} tag embeddings.")

    # -------------------------------------------------
    # Add new tags at runtime
    # -------------------------------------------------
    def add_new_tags(self, new_tags):
        """
        Add new tags to the embedding table. Safe with empty / duplicates.
        """
        if not new_tags:
            return

        # Normalize input
        new_tags = [t.lower() for t in new_tags]
        new_tags = [t for t in new_tags if t not in self.tag_embeddings]

        if not new_tags:
            return  # nothing new

        # Compute new embeddings
        new_embs = self.precompute_tag_embeddings(new_tags)

        # Merge into system
        for t, e in new_embs.items():
            self.tag_embeddings[t] = e

        self.tag_list_ordered = list(self.tag_embeddings.keys())
        self.tag_embedding_matrix = torch.stack(
            [self.tag_embeddings[t] for t in self.tag_list_ordered]
        )

        print(f"[CLIP] Added {len(new_embs)} new tags.")

    # -------------------------------------------------
    # Image → embedding
    # -------------------------------------------------
    def _embed_image(self, file_bytes):
        """
        Convert uploaded image → CLIP embedding.
        Returns None on failure.
        """
        try:
            img = Image.open(io.BytesIO(file_bytes)).convert("RGB")
        except Exception as e:
            print(f"[CLIP] Failed to load image: {e}")
            return None

        image_tensor = self.preprocess(img).unsqueeze(0).to(self.device).half()

        with torch.no_grad():
            emb = self.model.encode_image(image_tensor)
            emb = self._normalize(emb)

        return emb.squeeze(0)

    # -------------------------------------------------
    # Main API: return sorted tag suggestions
    # -------------------------------------------------
    def process_image(self, file_bytes, batch_size=1024):
        """
        Given an image (bytes), return tags sorted by similarity.
        Returns empty list if no tags are available.
        """

        # Safety: no tags available
        if self.tag_embedding_matrix is None or len(self.tag_list_ordered) == 0:
            return []

        # Image embedding
        img_emb = self._embed_image(file_bytes)
        if img_emb is None:
            return []  # failed to read or process image

        img_emb = img_emb.unsqueeze(0)  # shape: (1,512)

        # Compute similarity in batches to fit GPU memory
        similarities = []

        with torch.no_grad():
            for i in range(0, self.tag_embedding_matrix.shape[0], batch_size):
                batch_emb = self.tag_embedding_matrix[i:i + batch_size]  # (B,512)
                sim = (img_emb @ batch_emb.T).squeeze(0)  # (B,)
                similarities.append(sim)

        similarities = torch.cat(similarities)

        # Sort descending
        sorted_idxs = torch.argsort(similarities, descending=True)
        sorted_tags = [self.tag_list_ordered[i] for i in sorted_idxs.cpu().numpy()]
        sorted_scores = similarities[sorted_idxs].cpu().numpy().tolist()

        return [
            {"tag": t, "score": float(s)}
            for t, s in zip(sorted_tags, sorted_scores)
        ]
