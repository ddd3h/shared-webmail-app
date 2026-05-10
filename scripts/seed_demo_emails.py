import os
import sys
import uuid
import random
from datetime import datetime, timedelta
import psycopg2
from urllib.parse import urlparse

# Usage: python3 scripts/seed_demo_emails.py <mailbox_email>

def get_db_conn():
    # Read .env from project root
    env_path = os.path.join(os.getcwd(), '.env')
    db_url = ""
    if os.path.exists(env_path):
        with open(env_path, 'r') as f:
            for line in f:
                if line.startswith('DATABASE_URL='):
                    db_url = line.split('=', 1)[1].strip().strip('"').strip("'")
                    break
    
    if not db_url:
        print("DATABASE_URL not found in .env")
        sys.exit(1)
    
    result = urlparse(db_url)
    username = result.username
    password = result.password
    database = result.path[1:]
    hostname = result.hostname
    port = result.port
    
    return psycopg2.connect(
        database=database,
        user=username,
        password=password,
        host=hostname,
        port=port
    )

def seed(target_email):
    conn = get_db_conn()
    cur = conn.cursor()
    
    # 1. Find mailbox
    cur.execute("SELECT id FROM mailboxes WHERE email_address = %s AND type = 'team'", (target_email,))
    row = cur.fetchone()
    if not row:
        print(f"Team mailbox with email '{target_email}' not found.")
        sys.exit(1)
    mailbox_id = row[0]
    
    subjects = ["お問い合わせ", "見積依頼", "製品について", "不具合報告", "サポート依頼", "採用について", "取材依頼"]
    names = ["田中 太郎", "佐藤 花子", "鈴木 一郎", "高橋 健二", "伊藤 淳子", "渡辺 直樹"]
    domains = ["example.jp", "test.com", "mail.ne.jp", "service.org"]
    
    print(f"Seeding 1000 emails to {target_email} (ID: {mailbox_id})...")
    
    now = datetime.now()
    
    for i in range(1000):
        thread_id = str(uuid.uuid4())
        msg_id = str(uuid.uuid4())
        external_id = f"demo-{i}-{uuid.uuid4()}@example.com"
        
        subject = f"{random.choice(subjects)} [{i+1:04d}]"
        name = random.choice(names)
        sender_email = f"user{i}@{random.choice(domains)}"
        sent_at = now - timedelta(minutes=random.randint(1, 10000))
        
        # Insert Thread
        cur.execute("""
            INSERT INTO threads (id, mailbox_id, subject, normalized_subject, status, last_message_at, created_at, updated_at)
            VALUES (%s, %s, %s, %s, 'open', %s, %s, %s)
        """, (thread_id, mailbox_id, subject, subject, sent_at, sent_at, sent_at))
        
        # Insert Message
        cur.execute("""
            INSERT INTO messages (id, thread_id, mailbox_id, external_message_id, direction, from_name, from_email, to_raw, subject, text_body, sent_at, created_at)
            VALUES (%s, %s, %s, %s, 'incoming', %s, %s, %s, %s, %s, %s, %s)
        """, (msg_id, thread_id, mailbox_id, external_id, name, sender_email, target_email, subject, f"これはデモメール #{i+1} です。", sent_at, sent_at))
        
        if (i + 1) % 100 == 0:
            print(f"  {i + 1} items inserted...")
            conn.commit()

    conn.commit()
    cur.close()
    conn.close()
    print("Done.")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 scripts/seed_demo_emails.py <mailbox_email>")
        sys.exit(1)
    seed(sys.argv[1])
