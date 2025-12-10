# ==========================================
# FILE: database.py
# ==========================================
import sqlite3
from datetime import datetime
from config import OBJECTS_DB, RELATIONS_DB

def get_db_connection(db_path):
    """Get a database connection with proper settings"""
    conn = sqlite3.connect(db_path, timeout=10.0, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def init_databases():
    """Initialize both objects and relations databases"""
    # Objects database
    conn = get_db_connection(OBJECTS_DB)
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS objects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tags TEXT
    )
    """)
    conn.commit()
    conn.close()
    
    # Relations database
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    c.execute("""
    CREATE TABLE IF NOT EXISTS tag_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tag1 TEXT NOT NULL,
        tag2 TEXT NOT NULL,
        context_tags TEXT,
        relation_type TEXT NOT NULL,
        confidence REAL,
        tag1_count INTEGER,
        tag2_count INTEGER,
        bidirectional INTEGER DEFAULT 1,
        cooccurrence INTEGER DEFAULT 0,
        calculation TEXT,
        created_date TIMESTAMP,
        modified_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tag1, tag2, context_tags)
    )
    """)
    
    # Check and add missing columns with SQLite-compatible approach
    c.execute("PRAGMA table_info(tag_relations)")
    columns = [col[1] for col in c.fetchall()]
    
    if 'bidirectional' not in columns:
        c.execute("ALTER TABLE tag_relations ADD COLUMN bidirectional INTEGER DEFAULT 1")
    if 'cooccurrence' not in columns:
        c.execute("ALTER TABLE tag_relations ADD COLUMN cooccurrence INTEGER DEFAULT 0")
    if 'calculation' not in columns:
        c.execute("ALTER TABLE tag_relations ADD COLUMN calculation TEXT")
    if 'created_date' not in columns:
        # SQLite doesn't support CURRENT_TIMESTAMP as default in ALTER TABLE
        # Add column without default, then update with values
        c.execute("ALTER TABLE tag_relations ADD COLUMN created_date TIMESTAMP")
        # Set created_date to modified_date for existing records
        c.execute("UPDATE tag_relations SET created_date = modified_date WHERE created_date IS NULL")
    
    conn.commit()
    conn.close()

# Tag Relations Functions
def get_confirmed_synonyms():
    """
    Return dict of tag -> list of synonym tags
    Respects directionality: only returns valid directions
    """
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    c.execute("SELECT tag1, tag2, bidirectional FROM tag_relations WHERE relation_type='synonym'")
    rows = c.fetchall()
    conn.close()
    
    synonyms = {}
    for tag1, tag2, bidirectional in rows:
        # tag1 -> tag2 is always valid (stored direction)
        if tag1 not in synonyms:
            synonyms[tag1] = []
        synonyms[tag1].append(tag2)
        
        # tag2 -> tag1 only valid if bidirectional
        if bidirectional:
            if tag2 not in synonyms:
                synonyms[tag2] = []
            synonyms[tag2].append(tag1)
    
    return synonyms

def get_confirmed_antonyms():
    """
    Return set of (tag1, tag2, context) tuples
    Respects directionality: only returns valid directions
    """
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    c.execute("SELECT tag1, tag2, context_tags, bidirectional FROM tag_relations WHERE relation_type='antonym'")
    rows = c.fetchall()
    conn.close()
    
    antonyms = set()
    for tag1, tag2, context, bidirectional in rows:
        context = context or ""
        # tag1 -> tag2 is always valid (stored direction)
        antonyms.add((tag1, tag2, context))
        
        # tag2 -> tag1 only valid if bidirectional
        if bidirectional:
            antonyms.add((tag2, tag1, context))
    
    return antonyms

def get_unrelated_pairs():
    """Return set of (tag1, tag2) tuples marked as unrelated"""
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    c.execute("SELECT tag1, tag2 FROM tag_relations WHERE relation_type='unrelated'")
    rows = c.fetchall()
    conn.close()
    
    unrelated = set()
    for tag1, tag2 in rows:
        unrelated.add((tag1, tag2))
        unrelated.add((tag2, tag1))
    return unrelated

def add_tag_relation(tag1, tag2, relation_type, context_tags="", confidence=0.0, 
                     tag1_count=0, tag2_count=0, bidirectional=True, cooccurrence=0, calculation=""):
    """
    Add or update a tag relation with directionality
    """
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    
    try:
        # Check if relation already exists
        c.execute("SELECT id, created_date FROM tag_relations WHERE tag1=? AND tag2=? AND context_tags=?",
                  (tag1, tag2, context_tags))
        existing = c.fetchone()
        
        if existing:
            # Update existing relation, preserve created_date
            c.execute("""
            UPDATE tag_relations 
            SET relation_type=?, confidence=?, tag1_count=?, tag2_count=?, bidirectional=?, 
                cooccurrence=?, calculation=?, modified_date=?
            WHERE id=?
            """, (relation_type, confidence, tag1_count, tag2_count, 1 if bidirectional else 0,
                  cooccurrence, calculation, datetime.now(), existing[0]))
        else:
            # Insert new relation
            now = datetime.now()
            c.execute("""
            INSERT INTO tag_relations 
            (tag1, tag2, context_tags, relation_type, confidence, tag1_count, tag2_count, 
             bidirectional, cooccurrence, calculation, created_date, modified_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (tag1, tag2, context_tags, relation_type, confidence, tag1_count, tag2_count, 
                  1 if bidirectional else 0, cooccurrence, calculation, now, now))
        
        conn.commit()
    finally:
        conn.close()

def get_relation(tag1, tag2):
    """Get relation between two tags, checking both directions"""
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    
    # Check forward direction
    c.execute("""
        SELECT tag1, tag2, relation_type, context_tags, bidirectional 
        FROM tag_relations 
        WHERE tag1=? AND tag2=?
    """, (tag1, tag2))
    result = c.fetchone()
    
    if result:
        conn.close()
        return {
            'tag1': result[0],
            'tag2': result[1],
            'relation_type': result[2],
            'context_tags': result[3] or "",
            'bidirectional': bool(result[4]),
            'direction': 'forward'
        }
    
    # Check reverse direction if bidirectional
    c.execute("""
        SELECT tag1, tag2, relation_type, context_tags, bidirectional 
        FROM tag_relations 
        WHERE tag2=? AND tag1=? AND bidirectional=1
    """, (tag1, tag2))
    result = c.fetchone()
    
    conn.close()
    
    if result:
        return {
            'tag1': result[1],  # Swap back
            'tag2': result[0],
            'relation_type': result[2],
            'context_tags': result[3] or "",
            'bidirectional': True,
            'direction': 'reverse'
        }
    
    return None

def delete_tag_relation(relation_id):
    """Delete a tag relation by ID"""
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    c.execute("DELETE FROM tag_relations WHERE id=?", (relation_id,))
    conn.commit()
    conn.close()

def list_tag_relations(page=1, page_size=30, search="", sort_by="created_date_asc", 
                      filter_type=None, min_count=None, max_count=None):
    """
    List all tag relations with pagination, sorting, and filtering
    Returns: (relations, total, stats)
    """
    import time
    start_time = time.time()
    
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    
    # Add query timeout
    conn.execute("PRAGMA busy_timeout = 5000")  # 5 second timeout
    
    offset = (page - 1) * page_size
    
    # Build WHERE clause
    where_clauses = []
    params = []
    
    if search:
        where_clauses.append("(tag1 LIKE ? OR tag2 LIKE ?)")
        params.extend([f"%{search}%", f"%{search}%"])
    
    if filter_type:
        where_clauses.append("relation_type = ?")
        params.append(filter_type)
    
    if min_count is not None:
        where_clauses.append("(tag1_count >= ? OR tag2_count >= ?)")
        params.extend([min_count, min_count])
    
    if max_count is not None:
        where_clauses.append("(tag1_count <= ? AND tag2_count <= ?)")
        params.extend([max_count, max_count])
    
    where_clause = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Build ORDER BY clause with percentage calculation for gap
    if sort_by == "gap_desc":
        order_by = "ABS((CAST(cooccurrence AS FLOAT) / NULLIF(MIN(tag1_count, tag2_count), 0)) - 1) DESC"
    elif sort_by == "gap_asc":
        order_by = "ABS((CAST(cooccurrence AS FLOAT) / NULLIF(MIN(tag1_count, tag2_count), 0)) - 1) ASC"
    else:
        sort_mapping = {
            "created_date_desc": "created_date DESC",
            "created_date_asc": "created_date ASC",
            "modified_date_desc": "modified_date DESC",
            "modified_date_asc": "modified_date ASC",
            "tag1_count_desc": "tag1_count DESC",
            "tag1_count_asc": "tag1_count ASC",
            "tag2_count_desc": "tag2_count DESC",
            "tag2_count_asc": "tag2_count ASC",
        }
        order_by = sort_mapping.get(sort_by, "created_date ASC")
    
    query = f"""
    SELECT id, tag1, tag2, context_tags, relation_type, confidence, 
           tag1_count, tag2_count, bidirectional, cooccurrence, calculation, 
           created_date, modified_date
    FROM tag_relations 
    {where_clause}
    ORDER BY {order_by}
    LIMIT ? OFFSET ?
    """
    
    params.extend([page_size, offset])
    c.execute(query, params)
    rows = c.fetchall()
    
    # Get total count for the current filter
    count_query = f"SELECT COUNT(*) FROM tag_relations {where_clause}"
    c.execute(count_query, params[:-2])
    total = c.fetchone()[0]
    
    # Get total count by type for stats
    stats = {}
    c.execute("SELECT relation_type, COUNT(*) FROM tag_relations GROUP BY relation_type")
    for rel_type, count in c.fetchall():
        stats[rel_type] = count
    stats['total'] = sum(stats.values())
    
    conn.close()
    
    relations = []
    for row in rows:
        relations.append({
            "id": row[0],
            "tag1": row[1],
            "tag2": row[2],
            "context_tags": row[3],
            "relation_type": row[4],
            "confidence": row[5],
            "tag1_count": row[6],
            "tag2_count": row[7],
            "bidirectional": bool(row[8]),
            "cooccurrence": row[9],
            "calculation": row[10],
            "created_date": row[11],
            "modified_date": row[12]
        })
    
    elapsed = time.time() - start_time
    if elapsed > 1.0:
        print(f"[DB WARNING] list_tag_relations took {elapsed:.2f}s")
    
    return relations, total, stats

def update_relation_direction(relation_id, bidirectional, swap=False):
    """Update the directionality of an existing relation"""
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    
    if swap:
        # Swap tag1 and tag2
        c.execute("""
            UPDATE tag_relations 
            SET tag1 = tag2, tag2 = tag1, bidirectional = ?, modified_date = ?
            WHERE id = ?
        """, (1 if bidirectional else 0, datetime.now(), relation_id))
    else:
        # Just update bidirectional flag
        c.execute("""
            UPDATE tag_relations 
            SET bidirectional = ?, modified_date = ?
            WHERE id = ?
        """, (1 if bidirectional else 0, datetime.now(), relation_id))
    
    conn.commit()
    conn.close()

def update_relation_type(relation_id, new_type):
    """Update the type of a relation (synonym/antonym/unrelated)"""
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    
    c.execute("""
        UPDATE tag_relations 
        SET relation_type = ?, modified_date = ?
        WHERE id = ?
    """, (new_type, datetime.now(), relation_id))
    
    conn.commit()
    conn.close()