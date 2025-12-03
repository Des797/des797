# ==========================================
# FILE: config.py
# ==========================================
import torch

# Elasticsearch Configuration
ES_HOST = "https://localhost:9200"
ES_USER = "elastic"
ES_PASSWORD = "o_UsKFunknykh_hSGBJP"
ES_CA_CERT = r"D:\elasticsearch-9.2.1-windows-x86_64\elasticsearch-9.2.1\config\certs\http_ca.crt"
ES_INDEX = "objects"

# Database Configuration
OBJECTS_DB = "objects.db"
RELATIONS_DB = "tag_relations.db"

# Application Configuration
PAGE_SIZE = 50
CLIP_MODEL = "ViT-B/32"
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

# Suggestion Algorithm Parameters
ALPHA = 1.0  # Co-occurrence weight
BETA = 0.7   # Rarity weight
GAMMA = 1.5  # Contradiction penalty weight
MIN_TAG_OCCURRENCES = 10  # Minimum occurrences for rare tag suggestions
STRONG_CORRELATION_THRESHOLD = 0.99  # 99% co-occurrence threshold
SYNONYM_BOOST_SCORE = 10000
STRONG_CORRELATION_BOOST = 9999