"""
Database migration to add directionality to tag relations
Run this once to update your existing database
"""
import sqlite3
from config import RELATIONS_DB

def migrate_relations_db():
    conn = get_db_connection(RELATIONS_DB)
    c = conn.cursor()
    
    # Check if bidirectional column exists
    c.execute("PRAGMA table_info(tag_relations)")
    columns = [col[1] for col in c.fetchall()]
    
    if 'bidirectional' not in columns:
        print("Adding bidirectional column...")
        c.execute("ALTER TABLE tag_relations ADD COLUMN bidirectional INTEGER DEFAULT 1")
        conn.commit()
        print("Migration complete. All existing relations set as bidirectional by default.")
    else:
        print("Database already up to date.")
    
    conn.close()

if __name__ == "__main__":
    migrate_relations_db()