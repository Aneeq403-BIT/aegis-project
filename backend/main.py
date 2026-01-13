import asyncpg
import asyncio
import uuid
import logging
import datetime
import zipfile
import re 
import secrets
import os
import tempfile
import ssl 
import bcrypt
import hashlib
from typing import List, Dict, Optional, Any
from fpdf import FPDF
from jose import JWTError, jwt
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, status, Request
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field
from dotenv import load_dotenv
from fastapi.background import BackgroundTasks
import tasks
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# --- SYSTEM INITIALIZATION ---
load_dotenv()
logging.basicConfig(
    level=logging.INFO, 
    format='%(asctime)s - [AEGIS-SaaS-CORE] - %(levelname)s - %(message)s'
)
logger = logging.getLogger("AEGIS")

app = FastAPI(
    title="PROJECT AEGIS: SaaS Data Sovereignty Engine",
    description="Multi-Tenant Enterprise Introspection & Pseudonymization Platform",
    version="4.5.0"
)

# --- CORS CONFIGURATION (Ready for Cloud Deployment) ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", # For local testing
        "https://aegis-sovereignty.vercel.app" # REPLACE with your actual Vercel URL later
        ], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- SYSTEM CONFIGURATION ---
SECRET_KEY = os.getenv("SECRET_KEY", "aegis_proprietary_enterprise_secret_2024_x")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 1440 
AEGIS_PEPPER = "AEGIS_SaaS_INTERNAL_POLYMORPHIC_v4_SALT"
AEGIS_DB_DSN = os.getenv("DATABASE_URL", "postgresql://neondb_owner:npg_wDmWLOA6Pbt1@ep-proud-term-ahjm4vgd-pooler.c-3.us-east-1.aws.neon.tech/aegis_db?sslmode=require&channel_binding=require")

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# --- SMTP Server Configuration ---
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER")
SMTP_PASS = os.getenv("SMTP_PASS")

# --- PROPRIETARY HEURISTICS & PATTERNS ---
PII_KEYWORDS = ['name', 'email', 'ssn', 'social', 'phone', 'mobile', 'addr', 'city', 'zip', 'card', 'credit', 'dob', 'birth', 'password']
SAFE_KEYWORDS = ['id', 'date', 'time', 'amount', 'balance', 'price', 'merchant', 'status', 'code', 'type', 'sku', 'created', 'updated', 'is_active']
REGEX_PATTERNS = {
    'EMAIL': r'^[\w\.-]+@[\w\.-]+\.\w+$',
    'PHONE': r'^\+?1?\d{9,15}$',
    'CREDIT_CARD': r'^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$',
    'SSN': r'^\d{3}-?\d{2}-?\d{4}$'
}

# --- VOLATILE MULTI-TENANT JOB STORE ---
# Tracks jobs in real-time. In high-scale production, this would be Redis.
active_jobs: Dict[str, dict] = {}

# --- DATABASE LIFECYCLE MANAGEMENT ---
@app.on_event("startup")
async def startup_event():
    try:
        # Initializing the Master Audit Pool for SaaS Tenancy
        app.state.audit_pool = await asyncpg.create_pool(
            dsn=AEGIS_DB_DSN, 
            min_size=5, 
            max_size=30
        )
        logger.info("AEGIS SaaS: Master Audit Pool Established.")
    except Exception as e:
        logger.error(f"SYSTEM CRITICAL: Master Audit DB Connection Failed: {e}")
    asyncio.create_task(cleanup_stale_jobs())

@app.on_event("shutdown")
async def shutdown_event():
    if hasattr(app.state, 'audit_pool'):
        await app.state.audit_pool.close()
        logger.info("AEGIS SaaS: Master Audit Pool Successfully Terminated.")

# --- PYDANTIC MODELS (SaaS & Multi-Tenancy) ---

class UserSignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    organization_name: str
    full_name: str
    accept_privacy_policy: bool

class UserResponse(BaseModel):
    user_id: int
    email: str
    organization_name: str
    role: str

class ConnectionDetails(BaseModel):
    db_name: str
    user: str
    password: str
    host: str
    port: str = "5432"
    ssl_enabled: bool = True 

class BulkSearchRequest(BaseModel):
    connection: ConnectionDetails
    table_name: str
    primary_key_col: str
    target_ids: List[str]

class BulkErasureRequest(BaseModel):
    connection: ConnectionDetails
    target_table: str
    target_id_col: str
    target_ids: List[str]
    columns_to_clean: List[dict] 

# --- Privacy Policy Statment ---
AEGIS_LEGAL_TEXT = """
1. DATA ACCESS PERMISSION: By initializing an AEGIS Uplink, the Client grants AEGIS: The Introspection Engine 
explicit permission to access and scan the contents of the target database provided. This includes metadata, 
table schemas, and row-level data required for PII identification.

2. AUDIT LOGGING & PROOF OF ERASURE: The Client acknowledges that AEGIS maintains a permanent, non-volatile 
Audit Log of all erasure actions, including timestamps, target record identifiers, and successful/failed status. 
This log is stored for legal proof of compliance (GDPR Art. 17 / CCPA) and system safekeeping.

3. USER CONTENT ACCESS: AEGIS may process user-identifiable content to suggest erasure strategies. 
All data analyzed during 'Deep Introspection' is volatile and not stored beyond the duration of the scan.

4. SYSTEM CONSTRAINTS: AEGIS acts as a surgical tool. The Client is solely responsible for ensuring the 
provided Database credentials have sufficient permissions and that the removal of data does not violate 
their specific business logic or third-party contractual obligations.

5. CRYPTOGRAPHIC LIMITATIONS: While AGS-v3 Polymorphic Hashing is designed for irreversible pseudonymization, 
the Client accepts that the security of the hashed data also depends on the secrecy of the System Pepper 
and the complexity of the original strings.
"""

# --- SECURITY & PROPRIETARY HELPERS ---

def quote_ident(name: str):
    """Proprietary: Prevents SQL Injection by safely quoting identifiers for any DB."""
    return f'"{name.replace('"', '""')}"'

def generate_fingerprint(request: Request):
    """Proprietary: Fingerprints the Client device to prevent Token Stealing/Replay."""
    user_agent = request.headers.get("user-agent", "unknown")
    ip_addr = request.client.host
    return hashlib.sha256(f"{user_agent}{ip_addr}".encode()).hexdigest()

def get_aegis_custom_hash_sql(col_name: str, salt: str):
    """Proprietary: Implementation of the AGS-v3 Polymorphic Hashing Logic."""
    inner_val = f"'{AEGIS_PEPPER}' || '{salt}' || {quote_ident(col_name)}::text"
    return f"'AGS-v3-' || encode(sha256(({inner_val})::bytea), 'hex')"

def verify_password(plain_password: str, hashed_password: str):
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def hash_password(password: str):
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

def send_verification_email(dest_email: str, token: str):
    """
    Proprietary AEGIS Mailer: Dispatches a high-security activation link.
    This link points directly to the backend for instant activation.
    """
    # The link the user will click in their Gmail
    verify_url = f"http://127.0.0.1:8000/auth/verify/{token}"
    
    msg = MIMEMultipart()
    msg['From'] = f"AEGIS Sovereignty Engine <{SMTP_USER}>"
    msg['To'] = dest_email
    msg['Subject'] = "ACTION REQUIRED: Activate your AEGIS Node"

    # Professional HTML Body
    html_content = f"""
    <html>
        <body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #020617; color: #f8fafc; padding: 40px;">
            <div style="max-width: 600px; margin: auto; border: 1px solid #1e293b; padding: 40px; border-radius: 30px; background-color: #0f172a; text-align: center;">
                <h1 style="color: #06b6d4; font-size: 28px; letter-spacing: 2px;">PROJECT AEGIS</h1>
                <p style="color: #94a3b8; font-size: 16px;">A request has been made to initialize an Introspection Node for your organization.</p>
                <div style="margin: 40px 0;">
                    <a href="{verify_url}" style="background-color: #0891b2; color: #ffffff; padding: 18px 35px; text-decoration: none; border-radius: 12px; font-weight: bold; font-size: 14px; letter-spacing: 1px; box-shadow: 0 4px 15px rgba(6, 182, 212, 0.3);">ACTIVATE NODE UPLINK</a>
                </div>
                <p style="font-size: 11px; color: #475569;">Verification tokens expire in 24 hours. If you did not request this, please contact AEGIS security immediately.</p>
                <hr style="border: 0; border-top: 1px solid #1e293b; margin: 30px 0;">
                <p style="font-size: 10px; color: #334155;">AEGIS: THE INTROSPECTION ENGINE v4.6 (Cloud Ready)</p>
            </div>
        </body>
    </html>
    """
    msg.attach(MIMEText(html_content, 'html'))

    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT) as server:
            server.starttls() # Secure the connection
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        logger.info(f"Verification dispatch successful: {dest_email}")
    except Exception as e:
        logger.error(f"Mail Delivery System Failure: {e}")
        # We don't raise an exception here to avoid crashing the signup flow,
        # but in production, you'd want to handle this.

async def get_current_user(request: Request, token: str = Depends(oauth2_scheme)):
    """SaaS Tenancy Gate: Validates JWT, Fingerprint, and retrieves Client Identity."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Session Invalid or Expired",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        email: str = payload.get("sub")
        # Multi-Tenant Fingerprint Validation
        if payload.get("fpt") != generate_fingerprint(request):
            logger.warning(f"Fingerprint Mismatch for session: {email}")
            raise credentials_exception
        
        if email is None: raise credentials_exception

        async with app.state.audit_pool.acquire() as conn:
            user = await conn.fetchrow(
                "SELECT user_id, email, organization_name, role FROM users WHERE email = $1", 
                email
            )
        
        if user is None: raise credentials_exception
        return dict(user)
    except JWTError:
        raise credentials_exception

def build_dsn(c: ConnectionDetails):
    return f"postgresql://{c.user}:{c.password}@{c.host}:{c.port}/{c.db_name}"

def get_ssl_context(enabled: bool):
    if not enabled: return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE 
    return ctx

# --- THE BACKGROUND SaaS EXECUTION ENGINE ---

async def run_client_erasure_job(job_id: str, req: BulkErasureRequest, user_id: int, client_email: str):
    """
    Background Task: Handles massive erasure operations for remote Client Databases.
    Enforces Multi-Tenancy by tagging every log with a user_id.
    """
    active_jobs[job_id]["status"] = "establishing_uplink"
    timestamp = str(datetime.datetime.now())
    session_salt = secrets.token_hex(16)
    
    try:
        # Establish transient connection to Client's remote database
        dsn = build_dsn(req.connection)
        ssl_ctx = get_ssl_context(req.connection.ssl_enabled)
        target_conn = await asyncpg.connect(dsn, ssl=ssl_ctx)
        
        q_tbl = quote_ident(req.target_table)
        q_id_col = quote_ident(req.target_id_col)
        
        temp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
        active_jobs[job_id]["file_path"] = temp_zip.name
        active_jobs[job_id]["status"] = "executing_erasure"

        with zipfile.ZipFile(temp_zip.name, "w", zipfile.ZIP_DEFLATED) as zip_file:
            total_records = len(req.target_ids)
            
            for index, target_id in enumerate(req.target_ids):
                try:
                    # 1. Capture Pre-Erasure Snapshot for the Certificate
                    fetch_q = f"SELECT * FROM {q_tbl} WHERE {q_id_col}::text = $1"
                    row = await target_conn.fetchrow(fetch_q, str(target_id))
                    if not row: continue
                    original_data = dict(row)

                    # 2. Perform Surgical Cryptographic Erasure
                    async with target_conn.transaction():
                        for col_rule in req.columns_to_clean:
                            col = col_rule['col']
                            strategy = col_rule.get('strategy', 'HASH')
                            q_col = quote_ident(col)
                            
                            if strategy == 'HASH':
                                sql = f"UPDATE {q_tbl} SET {q_col} = {get_aegis_custom_hash_sql(col, session_salt)} WHERE {q_id_col}::text = $1"
                            elif strategy == 'MASK':
                                sql = f"UPDATE {q_tbl} SET {q_col} = '***-***-' || right({q_col}::text, 4) WHERE {q_id_col}::text = $1"
                            elif strategy == 'EMAIL_MASK':
                                sql = f"UPDATE {q_tbl} SET {q_col} = 'REDACTED_' || substring(md5({q_col}::text) from 1 for 6) || substring({q_col}::text from position('@' in {q_col}::text)) WHERE {q_id_col}::text = $1"
                            else: continue 

                            await target_conn.execute(sql, str(target_id))

                    # 3. Secure Audit Logging (Tied to Client user_id)
                    async with app.state.audit_pool.acquire() as audit_conn:
                        await audit_conn.execute("""
                            INSERT INTO audit_logs (user_id, target_db, target_table, target_pk_id, status)
                            VALUES ($1, $2, $3, $4, 'SUCCESS')
                        """, user_id, req.connection.db_name, req.target_table, str(target_id))

                    # 4. Generate Certificate of Erasure (Masked for Compliance)
                    try:
                        # Use Helvetica - it is the most stable 'standard' font for PDF buffers
                        pdf = FPDF(orientation='P', unit='mm', format='A4')
                        pdf.add_page()
    
                         # Header Header
                        pdf.set_font("Helvetica", 'B', 20)
                        pdf.set_text_color(22, 160, 133) # AEGIS Green
                        pdf.cell(190, 20, "AEGIS: CERTIFICATE OF ERASURE", ln=1, align='C')
    
                        # Metadata Section
                        pdf.set_font("Helvetica", 'B', 10)
                        pdf.set_text_color(0, 0, 0)
                        pdf.cell(190, 8, f"Project AEGIS SaaS v4.5 | Compliance Document", ln=1, align='C')
                        pdf.ln(5)
    
                        # Metadata Table
                        pdf.set_fill_color(240, 240, 240)
                        pdf.set_font("Helvetica", 'B', 9)
                        pdf.cell(50, 8, "Organization", border=1, fill=True)
                        pdf.set_font("Helvetica", '', 9)
                        pdf.cell(140, 8, str(active_jobs[job_id]['org']), border=1, ln=1)
    
                        pdf.set_font("Helvetica", 'B', 9)
                        pdf.cell(50, 8, "Execution Admin", border=1, fill=True)
                        pdf.set_font("Helvetica", '', 9)
                        pdf.cell(140, 8, str(client_email), border=1, ln=1)
    
                        pdf.set_font("Helvetica", 'B', 9)
                        pdf.cell(50, 8, "Record Identity", border=1, fill=True)
                        pdf.set_font("Helvetica", '', 9)
                        pdf.cell(140, 8, str(target_id), border=1, ln=1)

                        pdf.ln(10)
    
                        # Results Snapshot
                        pdf.set_font("Helvetica", 'B', 12)
                        pdf.cell(190, 10, "PROCESSED FIELD SNAPSHOT (MASKED)", ln=1)
    
                        pdf.set_font("Courier", '', 9) # Monospace for data
                        for k, v in original_data.items():
                            v_str = str(v)
                        # Apply the Masking again to be safe
                        masked = v_str[:2] + "********" if len(v_str) > 4 else "****"
        
                        # Ensure only printable latin-1 chars are used to prevent FPDF blanking out
                        safe_key = str(k).encode('latin-1', 'replace').decode('latin-1')
                        safe_val = masked.encode('latin-1', 'replace').decode('latin-1')
        
                        pdf.cell(60, 7, txt=safe_key, border=1)
                        pdf.cell(130, 7, txt=safe_val, border=1, ln=1)

                        pdf.ln(10)
                        pdf.set_font("Helvetica", 'I', 8)
                        pdf.multi_cell(190, 5, txt="Disclaimer: This document serves as legal proof that the PII associated with the above record has been pseudonymized via AEGIS AGS-v3 Polymorphic Hashing. The original data is no longer stored in plain-text.")

                        # IMPORTANT: Use 'bytearray' or 'bytes' for the zip writestr
                        # pdf.output(dest='S') returns a string in some versions, bytes in others.
                        pdf_content = pdf.output(dest='S')
    
                        if isinstance(pdf_content, str):
                            pdf_bytes = pdf_content.encode('latin-1')
                        else:
                            pdf_bytes = pdf_content

                        zip_file.writestr(f"AEGIS_Compliance_Cert_{target_id}.pdf", pdf_bytes)

                    except Exception as pdf_err:
                        logger.error(f"Failed to generate PDF for {target_id}: {pdf_err}")

                except Exception as rec_err:
                    logger.error(f"Job {job_id} | Record {target_id} failed: {rec_err}")
                    continue

        await target_conn.close()
        active_jobs[job_id]["status"] = "completed"
        logger.info(f"Erasure Job {job_id} finalized for Client {client_email}.")

    except Exception as fatal_e:
        logger.error(f"Job {job_id} Fatal System Error: {fatal_e}")
        active_jobs[job_id]["status"] = "failed"
        active_jobs[job_id]["error"] = str(fatal_e)

# --- SYSTEM MAINTENANCE: JOB CLEANUP ---

async def cleanup_stale_jobs():
    """
    Proprietary Maintenance Task: Runs every hour to clear the active_jobs dictionary
    and delete temp ZIP files to prevent server storage/RAM saturation.
    """
    while True:
        await asyncio.sleep(3600) # Run every hour
        now = datetime.datetime.now()
        expired_jobs = []
        
        for job_id, info in active_jobs.items():
            # If job is older than 24 hours, mark for deletion
            job_time = datetime.datetime.fromisoformat(info['timestamp'])
            if (now - job_time).total_seconds() > 86400:
                expired_jobs.append(job_id)
        
        for job_id in expired_jobs:
            job = active_jobs[job_id]
            if "file_path" in job and os.path.exists(job["file_path"]):
                try: os.unlink(job["file_path"])
                except: pass
            del active_jobs[job_id]
            logger.info(f"Maintenance: Purged expired job {job_id}")

# --- SaaS AUTHENTICATION & SIGNUP ENDPOINTS ---
# --- SIGNUP ENDPOINT ---

@app.post("/auth/signup")
async def signup(user: UserSignupRequest, background_tasks: BackgroundTasks):
    """
    SaaS Onboarding: Creates a 'Pending' account and triggers the Gmail logic.
    """
    if not user.accept_privacy_policy:
        raise HTTPException(status_code=400, detail="Policy acceptance is mandatory.")

    v_token = secrets.token_urlsafe(32)
    hashed_pass = hash_password(user.password)

    try:
        async with app.state.audit_pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO users (email, password_hash, organization_name, accepted_terms, 
                   terms_accepted_at, is_verified, verification_token) 
                   VALUES ($1, $2, $3, $4, $5, $6, $7)""",
                user.email, hashed_pass, user.organization_name, True, 
                datetime.datetime.now(), False, v_token
            )
        
        # Dispatch the email in the background 
        background_tasks.add_task(send_verification_email, user.email, v_token)
        
        return {
            "status": "pending", 
            "message": "Protocol Initiated. Please verify your email via the link sent to your inbox."
        }
    except asyncpg.UniqueViolationError:
        raise HTTPException(status_code=400, detail="Account already exists for this identity.")

# --- THE VERIFICATION ENDPOINT (Direct Browser Access) ---

@app.get("/auth/verify/{token}")
async def verify_email(token: str):
    """
    Endpoint triggered when user clicks the Gmail link.
    Returns a success message that appears directly in the browser.
    """
    async with app.state.audit_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT user_id, email FROM users WHERE verification_token = $1", token)
        
        if not user:
            # If token is invalid or already used
            return JSONResponse(
                status_code=400,
                content={"message": "Verification link is invalid or has expired."}
            )
        
        # Activate the user and clear the token
        await conn.execute(
            "UPDATE users SET is_verified = True, verification_token = NULL WHERE user_id = $1", 
            user['user_id']
        )
    
    # Return a professional HTML success page instead of raw JSON
    from fastapi.responses import HTMLResponse
    return HTMLResponse(content=f"""
        <html>
            <body style="background-color: #020617; color: #f8fafc; font-family: sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
                <div style="text-align: center; border: 1px solid #1e293b; padding: 50px; border-radius: 20px; background: #0f172a;">
                    <h1 style="color: #22c55e;">UPLINK AUTHORIZED</h1>
                    <p>The Node for <b>{user['email']}</b> is now active.</p>
                    <p style="color: #64748b;">You may now return to the AEGIS dashboard and login.</p>
                    <br>
                    <a href="http://localhost:5173" style="color: #06b6d4; text-decoration: none; font-weight: bold;">Return to Command Center</a>
                </div>
            </body>
        </html>
    """)

# --- UPDATED LOGIN (Check Verification) ---

@app.post("/token")
async def login(request: Request, form_data: OAuth2PasswordRequestForm = Depends()):
    async with app.state.audit_pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM users WHERE email = $1", form_data.username)
    
    if not user or not verify_password(form_data.password, user['password_hash']):
        raise HTTPException(status_code=401, detail="Invalid Credentials.")
    
    # CRITICAL: Prevent unverified login
    if not user['is_verified']:
        raise HTTPException(status_code=403, detail="Account pending email verification.")
    
    fingerprint = generate_fingerprint(request)
    token_data = {"sub": user['email'], "fpt": fingerprint, "role": user['role']}
    access_token = jwt.encode(token_data, SECRET_KEY, algorithm=ALGORITHM)
    return {"access_token": access_token, "token_type": "bearer"}

# --- SaaS SERVICE ENDPOINTS ---

@app.post("/scan-target")
async def scan_target_database(conn_details: ConnectionDetails, user=Depends(get_current_user)):
    """SaaS Introspection: Connects to a client's remote database and analyzes it."""
    dsn = build_dsn(conn_details)
    ssl_ctx = get_ssl_context(conn_details.ssl_enabled)
    try:
        conn = await asyncpg.connect(dsn, ssl=ssl_ctx)
        try:
            # Table Schema Scan
            query_cols = "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, ordinal_position;"
            rows = await conn.fetch(query_cols)
            
            # Primary Key Scan
            query_pk = """
                SELECT kcu.table_name, kcu.column_name 
                FROM information_schema.table_constraints tco 
                JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tco.constraint_name AND kcu.table_schema = tco.table_schema 
                WHERE tco.constraint_type = 'PRIMARY KEY';
            """
            pk_rows = await conn.fetch(query_pk)
            pk_map = {r['table_name']: r['column_name'] for r in pk_rows}

            schema_map = {}
            for r in rows:
                tbl, col, dtype = r['table_name'], r['column_name'], r['data_type']
                strategy, reason = "IGNORE", "Default"

                # 1. Keyword Heuristics
                if any(k in col.lower() for k in SAFE_KEYWORDS):
                    strategy, reason = "PRESERVE", "AEGIS Safe-List Match"
                elif 'email' in col.lower():
                    strategy, reason = "EMAIL_MASK", "Keyword Logic"
                elif any(k in col.lower() for k in ['ssn', 'phone', 'card', 'mobile', 'balance']):
                    strategy, reason = "MASK", "PII Identified"
                elif any(k in col.lower() for k in PII_KEYWORDS) and dtype in ['text', 'character varying']:
                    strategy, reason = "HASH", "Generic PII Match"
                
                # 2. Deep Introspection (Proprietary Sampling Analysis)
                if strategy == "IGNORE" and dtype in ['text', 'character varying']:
                    try:
                        sample_q = f"SELECT {quote_ident(col)} FROM {quote_ident(tbl)} WHERE {quote_ident(col)} IS NOT NULL LIMIT 5"
                        samples = await conn.fetch(sample_q)
                        for s_row in samples:
                            val = str(s_row[0])
                            for p_name, p_regex in REGEX_PATTERNS.items():
                                if re.match(p_regex, val):
                                    strategy, reason = "HASH", f"Deep Scan Match: {p_name}"
                                    break
                            if strategy == "HASH": break
                    except: pass

                if tbl not in schema_map: 
                    schema_map[tbl] = {"primary_key": pk_map.get(tbl, "UNKNOWN"), "columns": []}
                schema_map[tbl]["columns"].append({"name": col, "type": dtype, "suggested_strategy": strategy, "reason": reason})
            
            return {"status": "Analysis Complete", "schema": schema_map}
        finally:
            await conn.close()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Target Connection Error: {str(e)}")

@app.post("/fetch-batch-details", dependencies=[Depends(get_current_user)])
async def fetch_batch_details(req: BulkSearchRequest, user=Depends(get_current_user)):
    """
    AEGIS SaaS Logic: Retrieves a sample of records for the Strategy Preview.
    Uses SQL Identifier quoting and text-casting for universal PK support.
    """
    dsn = build_dsn(req.connection)
    ssl_ctx = get_ssl_context(req.connection.ssl_enabled)
    
    try:
        conn = await asyncpg.connect(dsn, ssl=ssl_ctx)
        try:
            # 1. Quote Identifiers for Safety
            q_tbl = quote_ident(req.table_name)
            q_pk = quote_ident(req.primary_key_col)
            
            # 2. Fetch records matching the provided IDs
            query = f"SELECT * FROM {q_tbl} WHERE {q_pk}::text = ANY($1::text[]) LIMIT 100"
            rows = await conn.fetch(query, req.target_ids)
            
            if not rows:
                return []

            results = []
            for row in rows:
                # Convert record to dictionary and ensure all values are string-safe for JSON
                data = dict(row)
                for k, v in data.items():
                    if isinstance(v, (datetime.datetime, datetime.date)):
                        data[k] = v.isoformat()
                    else:
                        data[k] = str(v)
                results.append(data)
                
            logger.info(f"SaaS Preview: {len(results)} records fetched for {user['email']}")
            return results
        finally:
            await conn.close()
    except Exception as e:
        logger.error(f"Fetch Batch Error: {e}")
        raise HTTPException(status_code=500, detail=f"Target Retrieval Failed: {str(e)}")

@app.post("/execute-erasure")
async def execute_erasure(req: BulkErasureRequest, bt: BackgroundTasks, user=Depends(get_current_user)):
    """SaaS Job Dispatcher: Initiates an erasure task for the client."""
    job_id = str(uuid.uuid4())
    active_jobs[job_id] = {
        "user_id": user['user_id'],
        "org": user['organization_name'],
        "status": "queued",
        "progress": 0,
        "admin": user['email'],
        "target_db": req.connection.db_name,
        "target_table": req.target_table,
        "timestamp": datetime.datetime.now().isoformat()
    }
    
    bt.add_task(run_client_erasure_job, job_id, req, user['user_id'], user['email'])
          
    return {"job_id": job_id, "status": "Protocol Initialized"}

@app.get("/job-status/{job_id}")
async def get_job_status(job_id: str, user=Depends(get_current_user)):
    """SaaS Tenancy Protected: Clients only see their own jobs."""
    job = active_jobs.get(job_id)
    if not job or job["user_id"] != user["user_id"]:
        raise HTTPException(status_code=404, detail="Execution Job ID Not Found")
    return job

@app.get("/download-results/{job_id}")
async def download_results(job_id: str, user=Depends(get_current_user)):
    """SaaS Tenancy Protected: Secure download of certificates."""
    job = active_jobs.get(job_id)
    if not job or job["user_id"] != user["user_id"] or job["status"] != "completed":
        raise HTTPException(status_code=400, detail="Batch results not ready.")
    
    return FileResponse(job["file_path"], media_type="application/zip", filename=f"AEGIS_CLEAN_REPORT_{job_id[:8]}.zip")

# --- SUPER ADMIN MANAGEMENT DASHBOARD ---

@app.get("/admin/system-logs")
async def get_all_logs(user=Depends(get_current_user)):
    """Proprietary Super Admin: Global Audit Visibility across all Clients."""
    if user['role'] != 'SUPER_ADMIN':
        raise HTTPException(status_code=403, detail="SaaS Dashboard Restricted to AEGIS Personnel.")
    
    async with app.state.audit_pool.acquire() as conn:
        logs = await conn.fetch("""
            SELECT a.log_id, u.email, u.organization_name, a.target_db, a.target_table, a.status, a.executed_at 
            FROM audit_logs a 
            JOIN users u ON a.user_id = u.user_id 
            ORDER BY a.executed_at DESC LIMIT 500
        """)
        return [dict(l) for l in logs]

@app.get("/admin/metrics")
async def get_system_metrics(user=Depends(get_current_user)):
    """Proprietary Super Admin: Operational Metrics."""
    if user['role'] != 'SUPER_ADMIN':
        raise HTTPException(status_code=403, detail="Unauthorized.")
    
    async with app.state.audit_pool.acquire() as conn:
        total_users = await conn.fetchval("SELECT COUNT(*) FROM users")
        total_erasures = await conn.fetchval("SELECT COUNT(*) FROM audit_logs")
        return {"total_clients": total_users, "total_records_processed": total_erasures}