
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

def fetch_all_tags_from_es(es, batch_size=1000):
    """Fetch all tag lists from all documents"""
    tag_lists = []
    sort_field = "added"
    body = {"size": batch_size, "_source": ["tags"], "sort": [{sort_field: "asc"}]}
    res = es.search(index=ES_INDEX, body=body)
    hits = res["hits"]["hits"]
    
    while hits:
        for hit in hits:
            tags = hit["_source"].get("tags", [])
            if tags:
                tag_lists.append([t.lower() for t in tags])
        last_sort = hits[-1]["sort"]
        body["search_after"] = last_sort
        res = es.search(index=ES_INDEX, body=body)
        hits = res["hits"]["hits"]
    
    return tag_lists