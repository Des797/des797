
# ==========================================
# FILE: elasticsearch_utils.py
# ==========================================
from elasticsearch import Elasticsearch
from config import ES_HOST, ES_USER, ES_PASSWORD, ES_CA_CERT, ES_INDEX

def get_es_client():
    """Get Elasticsearch client"""
    return Elasticsearch(
        ES_HOST,
        basic_auth=(ES_USER, ES_PASSWORD),
        ca_certs=ES_CA_CERT
    )

def fetch_unique_tags(es):
    """Fetch all unique tags from Elasticsearch"""
    query = {
        "size": 0,
        "aggs": {"unique_tags": {"terms": {"field": "tags.keyword", "size": 100000}}}
    }
    resp = es.search(index=ES_INDEX, body=query)
    tags = [bucket["key"] for bucket in resp["aggregations"]["unique_tags"]["buckets"]]
    return tags

def fetch_all_tags_from_es(es, max_docs=None, timeout_seconds=120):
    """
    Fetch all tag lists from Elasticsearch with timeout protection
    max_docs: if set, only fetch this many documents (for testing)
    timeout_seconds: abort if taking too long
    """
    from config import ES_INDEX
    import time
    
    start_time = time.time()
    tag_lists = []
    batch_size = 1000
    
    # Use scroll API for large datasets
    query = {"query": {"match_all": {}}, "size": batch_size, "_source": ["tags"]}
    
    try:
        # Initial search
        result = es.search(index=ES_INDEX, body=query, scroll='2m', request_timeout=30)
        scroll_id = result['_scroll_id']
        hits = result['hits']['hits']
        
        while hits:
            # Check timeout
            elapsed = time.time() - start_time
            if elapsed > timeout_seconds:
                print(f"\n⚠ WARNING: ES fetch timeout after {elapsed:.1f}s")
                print(f"  Fetched {len(tag_lists):,} documents so far")
                print(f"  Continuing with partial dataset...")
                break
            
            # Process batch
            for hit in hits:
                tags = hit['_source'].get('tags', [])
                if tags:  # Skip empty tag lists
                    tag_lists.append(tags)
            
            # Progress indicator
            if len(tag_lists) % 10000 == 0:
                print(f"  Fetched {len(tag_lists):,} documents... ({elapsed:.1f}s elapsed)")
            
            # Check if we hit max_docs limit
            if max_docs and len(tag_lists) >= max_docs:
                print(f"\n  Reached max_docs limit: {max_docs:,}")
                break
            
            # Get next batch
            try:
                result = es.scroll(scroll_id=scroll_id, scroll='2m', request_timeout=30)
                scroll_id = result['_scroll_id']
                hits = result['hits']['hits']
            except Exception as e:
                print(f"\n⚠ Scroll error: {e}")
                break
        
        # Clear scroll
        try:
            es.clear_scroll(scroll_id=scroll_id)
        except:
            pass
            
    except Exception as e:
        print(f"\n❌ ERROR fetching from ES: {e}")
        if not tag_lists:
            raise
    
    return tag_lists