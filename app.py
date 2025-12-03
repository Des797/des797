# ==========================================
# FILE: app.py (Main Flask Application)
# ==========================================
from flask import Flask, request, jsonify, render_template, Response
from threading import Thread
from datetime import datetime
import uuid
from collections import Counter
from functools import wraps
import random

from config import PAGE_SIZE, ES_INDEX
from database import (get_db_connection, init_databases, add_tag_relation, delete_tag_relation, 
                     list_tag_relations, update_relation_direction, update_relation_type)
from elasticsearch_utils import get_es_client, fetch_unique_tags, fetch_all_tags_from_es
from clip_utils import CLIPManager
from suggestion_engine import SuggestionEngine
from relation_analyzer import RelationAnalyzer
import sqlite3

# ==========================================
# ----- CONFIGURATION -----
# ==========================================
USERNAME = "admin"
PASSWORD = "supersecret"  # Change to your own strong password

def check_auth(username, password):
    return username == USERNAME and password == PASSWORD

def authenticate():
    return Response(
        'Authentication required', 401,
        {'WWW-Authenticate': 'Basic realm="Login Required"'}
    )

# ==========================================
# ----- FLASK APP -----
# ==========================================
app = Flask(__name__)
init_databases()

@app.before_request
def require_login():
    # Skip static files if needed
    if request.endpoint in ("static",):
        return
    auth = request.authorization
    if not auth or not check_auth(auth.username, auth.password):
        return authenticate()

# ==========================================
# ----- ELASTICSEARCH & CLIP SETUP -----
# ==========================================
es = get_es_client()
clip_manager = CLIPManager()

print("Initializing CLIP embeddings...")
unique_tags = fetch_unique_tags(es)
clip_manager.initialize_tags(unique_tags)

print("Fetching all tags from Elasticsearch...")
tag_lists = fetch_all_tags_from_es(es)
print(f"Fetched {len(tag_lists)} documents")

flat_tags = [tag for tags in tag_lists for tag in tags]
total_objects = len(tag_lists)
tag_counts = Counter(flat_tags)

tag_to_objects = {tag: set() for tag in tag_counts}
for idx, tags in enumerate(tag_lists):
    for t in tags:
        tag_to_objects[t].add(idx)

suggestion_engine = SuggestionEngine(tag_lists, tag_counts, tag_to_objects, total_objects)
relation_analyzer = RelationAnalyzer(tag_counts, tag_to_objects)

# ==========================================
# ----- SESSION TRACKING -----
# ==========================================
session_added = []
session_deleted = []
image_tasks = {}

# ==========================================
# ----- ROUTES (API & HTML) -----
# ==========================================
@app.route("/suggest", methods=["POST"])
def suggest():
    data = request.json
    input_tags = [t.lower() for t in data.get("tags", [])]
    top_n = data.get("top_n", 10)
    offset = data.get("offset", 0)
    result = suggestion_engine.calculate_suggestions(input_tags, top_n, offset)
    return jsonify(result)

@app.route("/get_tag_counts", methods=["POST"])
def get_tag_counts():
    """Get counts for specific tags"""
    data = request.json
    tags = data.get("tags", [])
    
    counts = {}
    for tag in tags:
        # Handle multi-tag queries
        if ' ' in tag:
            # Sum counts for multi-tag
            parts = tag.split()
            counts[tag] = sum(tag_counts.get(t, 0) for t in parts)
        else:
            counts[tag] = tag_counts.get(tag, 0)
    
    return jsonify(counts)

@app.route("/suggest_relations")
def suggest_relations_endpoint():
    limit = int(request.args.get("limit", 5))
    offset = int(request.args.get("offset", 0))
    relation_type = request.args.get("type", None)  # 'synonym', 'antonym', or None
    force_tag = request.args.get("force_tag", None)
    
    suggestions = relation_analyzer.calculate_suggested_relations(
        limit=limit * 2,  # Fetch extra to account for filtering
        offset=offset, 
        relation_type=relation_type,
        force_tag=force_tag
    )
    
    # Filter out any that already exist or are unrelated
    from database import get_unrelated_pairs
    unrelated = get_unrelated_pairs()
    
    filtered = []
    for sugg in suggestions:
        # Check if this pair is marked as unrelated
        pair_key = (sugg['tag1'], sugg['tag2'])
        reverse_key = (sugg['tag2'], sugg['tag1'])
        
        if pair_key in unrelated or reverse_key in unrelated:
            continue
        
        # Check if already exists in confirmed relations
        from database import get_relation
        existing = get_relation(sugg['tag1'], sugg['tag2'])
        if existing:
            continue
        
        filtered.append(sugg)
        
        if len(filtered) >= limit:
            break
    
    return jsonify(filtered[:limit])

@app.route("/confirm_relation", methods=["POST"])
def confirm_relation():
    data = request.json
    tag1 = data.get("tag1")
    tag2 = data.get("tag2")
    relation_type = data.get("relation_type")
    context_tags = data.get("context_tags", "")
    confidence = data.get("confidence", 0.0)
    tag1_count = data.get("tag1_count", 0)
    tag2_count = data.get("tag2_count", 0)
    bidirectional = data.get("bidirectional", True)
    user_swapped = data.get("user_swapped", False)
    cooccurrence = data.get("cooccurrence", 0)
    calculation = data.get("calculation", "")
    
    # If user didn't explicitly set direction and it's one-way,
    # ensure more specific tag (smaller count) points to broader tag (larger count)
    if not bidirectional and not user_swapped:
        if tag1_count > tag2_count:
            tag1, tag2 = tag2, tag1
            tag1_count, tag2_count = tag2_count, tag1_count
    
    add_tag_relation(tag1, tag2, relation_type, context_tags, confidence, 
                     tag1_count, tag2_count, bidirectional, cooccurrence, calculation)
    return jsonify({"status": "success"})

@app.route("/deny_relation", methods=["POST"])
def deny_relation():
    data = request.json
    tag1 = data.get("tag1")
    tag2 = data.get("tag2")
    add_tag_relation(tag1, tag2, "unrelated", "", 0, 0, 0, True)
    return jsonify({"status": "success"})

@app.route("/delete_relation", methods=["POST"])
def delete_relation():
    data = request.json
    relation_id = data.get("id")
    delete_tag_relation(relation_id)
    return jsonify({"status": "success"})

@app.route("/list_relations")
def list_relations_route():
    page = int(request.args.get("page", 1))
    page_size = int(request.args.get("page_size", 30))
    search = request.args.get("search", "")
    sort_by = request.args.get("sort_by", "created_date_asc")
    filter_type = request.args.get("filter_type", None)
    min_count = request.args.get("min_count", None)
    max_count = request.args.get("max_count", None)
    
    if min_count is not None:
        min_count = int(min_count)
    if max_count is not None:
        max_count = int(max_count)
    
    relations, total, stats = list_tag_relations(page, page_size, search, sort_by, 
                                                  filter_type, min_count, max_count)
    
    # Add current tag counts to each relation
    for rel in relations:
        # Handle multi-tag relations
        tag1_parts = rel['tag1'].split()
        tag2_parts = rel['tag2'].split()
        
        rel['tag1_current_count'] = sum(tag_counts.get(t, 0) for t in tag1_parts)
        rel['tag2_current_count'] = sum(tag_counts.get(t, 0) for t in tag2_parts)
    
    total_pages = max(1, (total + page_size - 1) // page_size)
    
    return jsonify({
        "relations": relations,
        "total": total,
        "total_pages": total_pages,
        "current_page": page,
        "stats": stats
    })

@app.route("/relation_chart_data/<int:relation_id>")
def relation_chart_data(relation_id):
    """Generate chart data for a specific relation"""
    from config import RELATIONS_DB
    
    conn = get_db_connection(RELATIONS_DB)
    try:
        c = conn.cursor()
        c.execute("""
            SELECT tag1, tag2, tag1_count, tag2_count, cooccurrence
            FROM tag_relations WHERE id=?
        """, (relation_id,))
        row = c.fetchone()
    finally:
        conn.close()
    
    if not row:
        return jsonify({"error": "Relation not found"}), 404
    
    tag1, tag2, tag1_count, tag2_count, cooccur = row
    
    # Calculate actual current counts
    tag1_parts = tag1.split()
    tag2_parts = tag2.split()
    
    tag1_actual = sum(tag_counts.get(t, 0) for t in tag1_parts)
    tag2_actual = sum(tag_counts.get(t, 0) for t in tag2_parts)
    
    cooccur = cooccur or 0
    
    tag1_only = max(0, tag1_actual - cooccur)
    tag2_only = max(0, tag2_actual - cooccur)
    
    return jsonify({
        "tag1": tag1,
        "tag2": tag2,
        "tag1_count": tag1_actual,
        "tag2_count": tag2_actual,
        "cooccurrence": cooccur,
        "tag1_only": tag1_only,
        "tag2_only": tag2_only,
        "overlap_percentage": round((cooccur / min(tag1_actual, tag2_actual) * 100) if tag1_actual and tag2_actual else 0, 1)
    })

@app.route("/update_relation_type", methods=["POST"])
def update_relation_type_route():
    """Update the type of an existing relation"""
    data = request.json
    relation_id = data.get("id")
    new_type = data.get("type")
    
    update_relation_type(relation_id, new_type)
    return jsonify({"success": True})

@app.route("/update_relation_direction", methods=["POST"])
def update_direction_route():
    """Update the directionality of an existing relation"""
    data = request.json
    relation_id = data.get("id")
    bidirectional = data.get("bidirectional", True)
    swap = data.get("swap", False)
    
    update_relation_direction(relation_id, bidirectional, swap)
    return jsonify({"success": True})

# ==========================================
# IMAGE PROCESSING ENDPOINTS
# ==========================================
def process_image_task(task_id, file_bytes):
    image_tasks[task_id]["status"] = "running"
    image_tasks[task_id]["progress"] = 0
    
    try:
        image_tasks[task_id]["progress"] = 10
        result = clip_manager.process_image(file_bytes)
        image_tasks[task_id]["tags"] = result
        image_tasks[task_id]["status"] = "completed"
        image_tasks[task_id]["progress"] = 100
    except Exception as e:
        image_tasks[task_id]["status"] = "error"
        image_tasks[task_id]["error"] = str(e)
        image_tasks[task_id]["progress"] = 100

@app.route("/submit_image", methods=["POST"])
def submit_image():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    file_bytes = request.files["file"].read()
    task_id = str(uuid.uuid4())
    image_tasks[task_id] = {"status": "pending", "progress": 0}
    Thread(target=process_image_task, args=(task_id, file_bytes), daemon=True).start()
    return jsonify({"task_id": task_id})

@app.route("/task_status/<task_id>")
def task_status(task_id):
    task = image_tasks.get(task_id)
    if not task:
        return jsonify({"error": "Task not found"}), 404
    return jsonify(task)

@app.route("/suggest_from_image", methods=["POST"])
def suggest_from_image():
    if "image" not in request.files:
        return jsonify({"error": "No image uploaded"}), 400
    
    file_bytes = request.files["image"].read()
    result = clip_manager.process_image(file_bytes)
    
    # Return top 10 tags
    top_tags = [item["tag"] for item in result[:10]]
    return jsonify({"tags": top_tags})

@app.route("/add_tags", methods=["POST"])
def add_tags():
    new_tags = request.json.get("tags", [])
    clip_manager.add_new_tags(new_tags)
    return jsonify({"status": "ok", "added": len(new_tags)})

# ==========================================
# OBJECT MANAGEMENT ENDPOINTS
# ==========================================
@app.route("/add_object", methods=["POST"])
def add_object_endpoint():
    data = request.json
    tags = data.get("tags", [])
    if not tags:
        return jsonify({"error": "No tags provided"}), 400
    obj_id = str(uuid.uuid4())
    es.index(index=ES_INDEX, id=obj_id, document={"tags": tags, "added": datetime.now()})
    session_added.append({"id": obj_id, "tags": tags})
    return jsonify({"id": obj_id, "tags": tags})

@app.route("/delete_object", methods=["POST"])
def delete_object_endpoint():
    data = request.json
    obj_id = data.get("id")
    if not obj_id:
        return jsonify({"error": "No ID provided"}), 400
    try:
        doc = es.get(index=ES_INDEX, id=obj_id)["_source"]
        es.delete(index=ES_INDEX, id=obj_id)
        session_deleted.append({"id": obj_id, "tags": doc.get("tags", [])})
        return jsonify({"deleted_id": obj_id, "tags": doc.get("tags", [])})
    except:
        return jsonify({"error": "Object not found"}), 404

@app.route("/list_objects", methods=["GET"])
def list_objects_endpoint():
    size = int(request.args.get("size", 50))
    res = es.search(
        index=ES_INDEX,
        body={
            "size": size,
            "sort": [{"added": {"order": "desc"}}],
            "_source": ["tags"]
        }
    )
    objects = [{"id": hit["_id"], "tags": hit["_source"]["tags"]} for hit in res["hits"]["hits"]]
    return jsonify(objects)

@app.route("/count_objects")
def count_objects_endpoint():
    total_count = es.count(index=ES_INDEX)["count"]
    return jsonify({"total": total_count})

@app.route("/preview_duplicates", methods=["GET"])
def preview_duplicates():
    res = es.search(index=ES_INDEX, body={"size": 10000, "_source": ["tags"]})
    objects = [{"id": hit["_id"], "tags": tuple(sorted(hit["_source"]["tags"]))} for hit in res["hits"]["hits"]]
    seen = {}
    duplicates = {}
    for obj in objects:
        key = obj["tags"]
        if key in seen:
            duplicates.setdefault(key, []).append(obj["id"])
        else:
            seen[key] = obj["id"]
    preview = [{"tags": list(tag_set), "duplicate_ids": ids} for tag_set, ids in duplicates.items()]
    return jsonify(preview)

@app.route("/delete_duplicates", methods=["POST"])
def delete_duplicates():
    data = request.json
    ids_to_delete = data.get("ids", [])
    deleted_ids = []
    for obj_id in ids_to_delete:
        try:
            es.delete(index=ES_INDEX, id=obj_id)
            deleted_ids.append(obj_id)
        except:
            pass
    return jsonify({"status": "success", "deleted_ids": deleted_ids})

@app.route("/revert_session", methods=["POST"])
def revert_session():
    reverted = {"added_deleted": [], "deleted_restored": []}
    for obj in session_added:
        if es.exists(index=ES_INDEX, id=obj["id"]):
            es.delete(index=ES_INDEX, id=obj["id"])
            reverted["added_deleted"].append(obj["id"])
    session_added.clear()
    for obj in session_deleted:
        es.index(index=ES_INDEX, id=obj["id"], document={"tags": obj["tags"]})
        reverted["deleted_restored"].append(obj["id"])
    session_deleted.clear()
    return jsonify({"status": "success", "reverted": reverted})

@app.route("/fetch_objects")
def fetch_objects():
    page = int(request.args.get("page", 1))
    search_text = request.args.get("search", "").strip()
    page_size = PAGE_SIZE

    query = {"match_all": {}} if not search_text else {"match": {"tags": {"query": search_text}}}

    body = {
        "query": query,
        "size": page_size,
        "sort": [
            {"added": {"order": "desc"}},
            {"_doc": "asc"}
        ]
    }

    current_hits = []
    res = es.search(index=ES_INDEX, body=body)
    current_hits = res["hits"]["hits"]
    current_page = 1

    while current_page < page and current_hits:
        last_sort = current_hits[-1].get("sort")
        if not last_sort:
            break
        body["search_after"] = last_sort
        res = es.search(index=ES_INDEX, body=body)
        current_hits = res["hits"]["hits"]
        current_page += 1

    hits = current_hits
    objects = [{"id": h["_id"], "tags": h["_source"]["tags"]} for h in hits]

    total_hits = es.count(index=ES_INDEX, body={"query": query})["count"]
    total_pages = max(1, (total_hits + page_size - 1) // page_size)

    return jsonify({"objects": objects, "total_pages": total_pages})

# ==========================================
# HTML PAGES
# ==========================================
@app.route("/")
def index():
    return render_template("index.html")

@app.route("/all_objects")
def all_objects_page():
    return render_template("all_objects.html")

@app.route("/all_tags")
def all_tags_page():
    # Scroll through all objects to collect tags
    batch_size = 1000
    tags_count = {}
    sort_field = "added"
    body = {"_source": ["tags"], "size": batch_size, "sort": [{sort_field: "asc"}]}

    res = es.search(index=ES_INDEX, body=body)
    hits = res["hits"]["hits"]

    while hits:
        for hit in hits:
            for t in hit["_source"].get("tags", []):
                tags_count[t] = tags_count.get(t, 0) + 1
        last_sort = hits[-1]["sort"]
        body["search_after"] = last_sort
        res = es.search(index=ES_INDEX, body=body)
        hits = res["hits"]["hits"]

    # Sort tags by frequency
    tags_list = sorted(tags_count.items(), key=lambda x: x[1], reverse=True)
    
    return render_template("all_tags.html", tags_list=tags_list)

@app.route("/relations_manager")
def relations_manager():
    return render_template("relations_manager.html")

# ==========================================
# ----- RUN SERVER -----
# ==========================================
if __name__ == "__main__":
    PORT = 54112
    LOCAL_IP = "192.168.1.165"
    
    print(f"Running Tag Suggest GUI at http://{LOCAL_IP}:{PORT}")
    
    import logging
    log = logging.getLogger('werkzeug')
    log.setLevel(logging.ERROR)
    
    app.run(host=LOCAL_IP, port=PORT, debug=True, threaded=True)