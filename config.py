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

PERF_SETTINGS = {
    'max_tags_to_analyze': 800,
    'min_tag_frequency_synonym': 10,
    'min_tag_frequency_antonym': 50,
    'enable_parallel_processing': True,
    'num_worker_processes': None,  # None = auto-detect (cpu_count - 1)
    'suggestion_cache_duration': 30,  # seconds
    'skip_sparse_objects': True,  # Skip objects with < min_tags_per_object
    'min_tags_per_object': 3,  # Only process objects with at least N tags
    'preload_suggestions_on_page_load': False,  # If False, only load on demand
}

# Default settings (for reset)
PERF_SETTINGS_DEFAULTS = PERF_SETTINGS.copy()