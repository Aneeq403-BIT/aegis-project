import { useState, useEffect } from 'react'
import logo from './assets/logo.png' 

// --- DYNAMIC INFRASTRUCTURE CONFIG ---
// This variable automatically uses the Vercel environment variable in production
// but falls back to your local machine for development.
const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export default function App() {
  // --- AUTHENTICATION STATE ---
  const [token, setToken] = useState(localStorage.getItem('aegis_token') || null)
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('aegis_user')) || null)
  const [isSignup, setIsSignup] = useState(false)
  
  // Login/Signup Inputs
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [org, setOrg] = useState('')

  const [acceptedPolicy, setAcceptedPolicy] = useState(false); // Tracks the checkbox

  // --- ENGINE STATE ---
  const [step, setStep] = useState(1)
  const [dbCreds, setDbCreds] = useState({ 
      db_name: '', user: 'postgres', password: 'root', 
      host: 'localhost', port: '5432', ssl_enabled: true 
  })
  const [schema, setSchema] = useState(null)
  const [selectedTable, setSelectedTable] = useState('')
  const [mode, setMode] = useState('SINGLE') 
  const [singleId, setSingleId] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [listIds, setListIds] = useState('')
  
  const [targetIds, setTargetIds] = useState([]) 
  const [targetDetails, setTargetDetails] = useState([])
  
  // --- JOB TRACKING STATE (10/10 Architecture) ---
  const [activeJobId, setActiveJobId] = useState(null)
  const [jobStatus, setJobStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState([])

  // Persistence Hook: Keeps you logged in after page refresh
  useEffect(() => {
    if (token) {
        localStorage.setItem('aegis_token', token);
        localStorage.setItem('aegis_user', JSON.stringify(user));
    } else {
        localStorage.removeItem('aegis_token');
        localStorage.removeItem('aegis_user');
    }
  }, [token, user]);

  // Polling Hook for Background Jobs
  useEffect(() => {
    let interval;
    // Only poll if there is an active job that isn't finished or failed
    if (activeJobId && jobStatus?.status !== 'completed' && jobStatus?.status !== 'failed') {
        interval = setInterval(async () => {
            try {
                const res = await authFetch(`${API_URL}/job-status/${activeJobId}`);
                const data = await res.json();
                setJobStatus(data);
                if (data.status === 'completed') {
                    setLog(p => [...p, `✅ Protocol Job ${activeJobId.slice(0,8)} successfully finalized.`]);
                    setStep(4);
                }
                if (data.status === 'failed') {
                    setLog(p => [...p, `❌ Protocol Job ${activeJobId.slice(0,8)} aborted: ${data.error}`]);
                }
            } catch (e) { 
                console.error("Polling Error", e);
                setLog(p => [...p, `⚠️ Background process polling interrupted.`]);
            }
        }, 2000);
    }
    return () => clearInterval(interval);
  }, [activeJobId, jobStatus]);

  // --- API WRAPPERS ---

  const authFetch = async (url, options = {}) => {
      const headers = options.headers || {};
      headers['Authorization'] = `Bearer ${token}`;
      if (!(options.body instanceof FormData)) {
          headers['Content-Type'] = 'application/json';
      }
      return fetch(url, { ...options, headers });
  }

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData();
    formData.append('username', email); 
    formData.append('password', password);

    try {
        const res = await fetch(`${API_URL}/token`, { method: 'POST', body: formData });
        const data = await res.json();
        
        if (!res.ok) throw new Error(data.detail || "Authorization Handshake Denied");
        
        setToken(data.access_token);
        // Determining role based on system login logic
        setUser({ email, role: email.includes('admin') ? 'SUPER_ADMIN' : 'CLIENT' });
        setLog(p => [...p, `🔑 Secure session uplink established for ${email}`]);
    } catch(err) { 
        alert(err.message);
        setLog(p => [...p, `❌ Security Alert: ${err.message}`]);
    }
    setLoading(false);
  }

const handleSignup = async (e) => {
   e.preventDefault();
   if (!acceptedPolicy) {
       alert("Authorization required: You must accept the Privacy & Access Policy.");
       return;
   }
   setLoading(true);
   try {
       const res = await fetch(`${API_URL}/auth/signup`, {
           method: 'POST',
           headers: { 'Content-Type': 'application/json' },
           body: JSON.stringify({ 
               email, 
               password, 
               organization_name: org, 
               full_name: org,
               accept_privacy_policy: acceptedPolicy 
           })
       });
       const data = await res.json();
       
       if (!res.ok) throw new Error(data.detail || "Account Registration Rejected");
       
       alert("NODE INITIALIZED: A verification link has been sent to " + email + ". Please authorize your account via Gmail before logging in.");
       setLog(p => [...p, `📩 Verification dispatch sent to ${email}`]);
       setIsSignup(false); 
    } catch(err) { 
        alert(err.message); 
    }
   setLoading(false);
}

  // --- ENGINE LOGIC ---

  const handleConnect = async () => {
    if(!dbCreds.db_name || !dbCreds.host) { alert("Incomplete DSN metadata."); return; }
    setLoading(true);
    try {
      const res = await authFetch(`${API_URL}/scan-target`, {
        method: 'POST', body: JSON.stringify(dbCreds)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Remote Target Refused Connection");
      setSchema(data.schema);
      setStep(2);
      setLog(p => [...p, `📡 Introspection Uplink established with ${dbCreds.db_name}`]);
    } catch (e) { 
        alert("Link Error: " + e.message);
        setLog(p => [...p, `❌ Uplink Failed: ${e.message}`]);
    }
    setLoading(false);
  }

  const handlePrepare = async () => {
    if (!selectedTable) { alert("Table selection required."); return; }
    
    let ids = [];
    // --- CRASH PROTECTION & OUT-OF-BOUNDS LOGIC ---
    try {
        if (mode === 'SINGLE') {
            if (!singleId.trim()) throw new Error("Primary Key ID cannot be null.");
            ids.push(singleId.trim());
        } 
        else if (mode === 'RANGE') {
            const start = parseInt(rangeStart);
            const end = parseInt(rangeEnd);
            if (isNaN(start) || isNaN(end)) throw new Error("Integer scope required for Range Mode.");
            if (start > end) throw new Error("Range termination cannot be lower than initialization.");
            
            // Preventing Memory Exhaustion (Safety Guard)
            if ((end - start) > 2000) throw new Error("Scope Limit: Max 2,000 records per batch for performance integrity.");
            
            for (let i = start; i <= end; i++) ids.push(String(i));
        } else {
            if (!listIds.trim()) throw new Error("Identification list is empty.");
            ids = listIds.split(',').map(x => x.trim()).filter(x => x !== '');
            if (ids.length > 500) throw new Error("Scope Limit: Manual list restricted to 500 entries.");
        }

        setLoading(true);
        const pkCol = schema?.[selectedTable]?.primary_key || "UNKNOWN";
        
        const res = await authFetch(`${API_URL}/fetch-batch-details`, {
            method: 'POST', body: JSON.stringify({
                connection: dbCreds,
                table_name: selectedTable,
                primary_key_col: pkCol,
                target_ids: ids
            })
        });
        
        const data = await res.json();
        
        // Final guard against empty DB responses
        if (!res.ok || !data || data.length === 0) {
            throw new Error("Target Retrieval Failed: No records matched the provided isolation scope.");
        }

        setTargetIds(ids);
        setTargetDetails(data);
        setStep(3);
        setLog(p => [...p, `🔍 Scope Isolated: ${data.length} records in [${selectedTable}]`]);
    } catch (e) { 
        alert(e.message);
        setLog(p => [...p, `⚠️ Scope Error: ${e.message}`]);
    }
    setLoading(false);
  }

  const handleExecuteProtocol = async () => {
    if (!confirm(`Commit irreversible AGS-v3 erasure protocol for ${targetIds.length} records?`)) return;
    
    setLoading(true);
    // Deep Check for schema context
    const currentTableSchema = schema?.[selectedTable];
    if (!currentTableSchema) {
        alert("Metadata context corrupted. Reconnect to target.");
        return;
    }

    const colsToClean = currentTableSchema.columns
      .filter(col => col.suggested_strategy !== 'IGNORE' && col.suggested_strategy !== 'PRESERVE')
      .map(col => ({ col: col.name, strategy: col.suggested_strategy }));

    try {
        const res = await authFetch(`${API_URL}/execute-erasure`, {
          method: 'POST', 
          body: JSON.stringify({
            connection: dbCreds,
            target_table: selectedTable,
            target_id_col: currentTableSchema.primary_key,
            target_ids: targetIds,
            columns_to_clean: colsToClean
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || "Protocol Dispatch Rejected");
        
        setActiveJobId(data.job_id);
        setJobStatus({ status: 'queued', progress: 0 });
        setLog(p => [...p, `🚀 Protocol Job ${data.job_id.slice(0,8)} dispatched to background node.`]);
    } catch (e) { 
        alert(e.message);
        setLog(p => [...p, `❌ Execution Fatal: ${e.message}`]);
    }
    setLoading(false);
  }

  const downloadResults = async () => {
    try {
        const res = await authFetch(`${API_URL}/download-results/${activeJobId}`);
        if (!res.ok) throw new Error("Archive expired or unavailable.");
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `AEGIS_CLEAN_REPORT_${activeJobId.slice(0,8)}.zip`;
        a.click();
    } catch (e) { alert("Data transmission error: " + e.message); }
  }

  // --- UI COMPONENTS ---

if (!token) {
  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center font-sans p-4">
        <div className="bg-slate-800 p-10 rounded-3xl shadow-2xl border border-slate-700 w-full max-w-md">
            <img src={logo} className="w-24 mx-auto mb-6 drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]" />
            <h1 className="text-3xl font-black text-white text-center mb-2">AEGIS <span className="text-cyan-500">ENGINE</span></h1>
            <p className="text-slate-400 text-center text-sm mb-8">{isSignup ? 'Initialize your Client Node' : 'Authorized Personnel Access Only'}</p>
            
            <form onSubmit={isSignup ? handleSignup : handleLogin} className="space-y-4">
                {isSignup && (
                  <div className="space-y-4 animate-in fade-in duration-500">
                    <input className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-white focus:border-cyan-500 outline-none transition-all" 
                    placeholder="Organization Name" required value={org} onChange={e => setOrg(e.target.value)} />
                    
                    {/* PRIVACY POLICY CONTEXT */}
                    <div className="bg-slate-900 border border-slate-700 rounded-xl p-4 text-[10px] text-slate-400 h-32 overflow-y-auto font-mono leading-relaxed shadow-inner custom-scrollbar">
                        <p className="font-bold text-cyan-500 mb-2 uppercase tracking-widest border-b border-slate-700 pb-1">AEGIS PRIVACY & ACCESS POLICY v4.6</p>
                        <p className="mb-2">1. DATA ACCESS: You grant AEGIS surgical access to scan all database contents, including sensitive PII for introspection purposes.</p>
                        <p className="mb-2">2. AUDIT LOGS: We maintain immutable logs of all erasures for legal proof of compliance and system safekeeping.</p>
                        <p className="mb-2">3. USER CONTENTS: You permit the temporary sampling of row-level data to enable Deep Scan heuristics.</p>
                        <p className="mb-2">4. LIABILITY: The client is responsible for database integrity and ensuring AEGIS has the correct user permissions.</p>
                        <p>5. PSEUDONYMIZATION: You acknowledge that erasure is irreversible once the AGS-v3 Protocol is committed.</p>
                    </div>

                    <div className="flex items-start gap-3 p-2 bg-slate-900/50 rounded-lg border border-slate-700">
                        <input 
                            type="checkbox" 
                            id="policy" 
                            checked={acceptedPolicy} 
                            onChange={(e) => setAcceptedPolicy(e.target.checked)}
                            className="mt-1 w-4 h-4 accent-cyan-500 cursor-pointer" 
                        />
                        <label htmlFor="policy" className="text-[10px] text-slate-300 leading-tight cursor-pointer">
                            I acknowledge the AEGIS Policy and grant explicit permission to access my remote database contents for introspection and erasure.
                        </label>
                    </div>
                  </div>
                )}

                <input className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-white focus:border-cyan-500 outline-none transition-all" 
                    placeholder="Corporate Email" type="email" required value={email} onChange={e => setEmail(e.target.value)} />
                <input className="w-full bg-slate-950 border border-slate-700 rounded-xl p-4 text-white focus:border-cyan-500 outline-none transition-all" 
                    type="password" placeholder="Key Phrase" required value={password} onChange={e => setPassword(e.target.value)} />
                
                <button 
                  type="submit" 
                  disabled={loading || (isSignup && !acceptedPolicy)} 
                  className={`w-full py-4 rounded-xl text-white font-black tracking-widest shadow-lg transition-all ${
                      (isSignup && !acceptedPolicy) ? 'bg-slate-700 cursor-not-allowed grayscale' : 'bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500'
                  }`}
                >
                    {loading ? "PROCESSING..." : isSignup ? "AUTHORIZE & REGISTER" : "SECURE LOGIN"}
                </button>
            </form>
            
            <button onClick={() => { setIsSignup(!isSignup); setAcceptedPolicy(false); }} className="w-full text-slate-500 text-xs mt-6 hover:text-cyan-400 transition-colors">
                {isSignup ? "Already have an uplink? Login" : "Need an AEGIS account? Register Organization"}
            </button>
        </div>
    </div>
  )
}

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 selection:bg-cyan-500/30">
      <div className="max-w-7xl mx-auto grid grid-cols-12 gap-8">
        
        {/* SIDEBAR: SYSTEM MONITOR */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col items-center text-center shadow-xl">
            <img src={logo} className="w-20 h-20 mb-4" />
            <h1 className="text-2xl font-black text-white">AEGIS <span className="text-cyan-500">v4.5</span></h1>
            <p className="text-[10px] text-slate-500 uppercase tracking-[0.3em] mt-1">Sovereignty Engine</p>
            
            <div className="w-full mt-6 p-4 bg-slate-950 rounded-2xl border border-slate-800 text-left">
                <p className="text-[10px] text-slate-500 uppercase font-bold">Node Identity</p>
                <p className="text-sm font-mono text-cyan-400 truncate">{user?.email}</p>
                <p className="text-[10px] text-green-500 mt-2 font-bold uppercase tracking-tighter">● System Online</p>
            </div>
            
            <button onClick={() => {setToken(null); setStep(1);}} className="mt-4 text-xs text-red-500 hover:text-red-400 font-bold uppercase tracking-widest">Terminate Session</button>
          </div>

          <div className="bg-black/40 rounded-3xl border border-slate-800 p-4 font-mono text-[10px] h-64 overflow-y-auto shadow-inner">
            <p className="text-slate-600 mb-2 border-b border-slate-800 pb-1 uppercase font-bold tracking-widest text-center">Kernel Stream</p>
            {log.map((l, i) => <div key={i} className="mb-1 text-cyan-500/80 tracking-tighter">{`> ${l}`}</div>)}
          </div>
        </div>

        {/* MAIN INTERFACE: THE COMMAND CENTER */}
        <div className="col-span-12 lg:col-span-9 bg-slate-900/50 border border-slate-800 rounded-[3rem] p-10 relative shadow-2xl backdrop-blur-sm min-h-[600px] flex flex-col">
          
          {/* STEP 1: UPLINK */}
          {step === 1 && (
            <div className="max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700 w-full">
                <h2 className="text-4xl font-black text-white mb-2">Remote Link</h2>
                <p className="text-slate-400 mb-10 text-lg">Initialize target database DSN for surgical introspection.</p>
                
                <div className="grid grid-cols-2 gap-6">
                    <div className="col-span-2">
                        <label className="text-xs font-bold text-slate-500 uppercase ml-2">Remote Host (Cloud DSN)</label>
                        <input className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 mt-2 focus:ring-2 ring-cyan-500/20 outline-none text-white" 
                        placeholder="e.g. ep-cool-dark-123.aws.neon.tech" value={dbCreds.host} onChange={e => setDbCreds({...dbCreds, host: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase ml-2">DB Identifier</label>
                        <input className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 mt-2 text-white" 
                        placeholder="neondb" value={dbCreds.db_name} onChange={e => setDbCreds({...dbCreds, db_name: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase ml-2">Port</label>
                        <input className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 mt-2 text-white" 
                        value={dbCreds.port} onChange={e => setDbCreds({...dbCreds, port: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase ml-2">Admin User</label>
                        <input className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 mt-2 text-white" 
                        value={dbCreds.user} onChange={e => setDbCreds({...dbCreds, user: e.target.value})} />
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase ml-2">Access Key</label>
                        <input className="w-full bg-slate-950 border border-slate-800 rounded-2xl p-4 mt-2 text-white" type="password" 
                        value={dbCreds.password} onChange={e => setDbCreds({...dbCreds, password: e.target.value})} />
                    </div>
                </div>

                <div className="mt-10 flex items-center justify-between bg-slate-950 p-6 rounded-3xl border border-slate-800">
                    <div>
                        <p className="text-white font-bold">Encrypted Handshake</p>
                        <p className="text-xs text-slate-500">Force SSL/TLS protocols for production safety.</p>
                    </div>
                    <input type="checkbox" checked={dbCreds.ssl_enabled} className="w-6 h-6 rounded accent-cyan-500 cursor-pointer"
                        onChange={e => setDbCreds({...dbCreds, ssl_enabled: e.target.checked})} />
                </div>

                <button onClick={handleConnect} disabled={loading} className="w-full mt-10 bg-white text-slate-900 py-5 rounded-3xl font-black text-xl hover:bg-cyan-400 transition-all shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
                    {loading ? "ANALYZING TARGET..." : "INITIALIZE SCAN"}
                </button>
            </div>
          )}

          {/* STEP 2: CONFIGURATION */}
          {step === 2 && (
            <div className="animate-in slide-in-from-right duration-500 h-full flex flex-col w-full">
                <div className="flex justify-between items-start mb-10">
                    <div>
                        <h2 className="text-4xl font-black text-white mb-2">Isolation Protocol</h2>
                        <p className="text-slate-400">Identify specific table clusters and record scopes.</p>
                    </div>
                    <button onClick={() => setStep(1)} className="text-cyan-500 font-bold border-b border-cyan-500">Kill Uplink</button>
                </div>

                <div className="grid grid-cols-1 gap-8 flex-grow">
                    <div className="bg-slate-950 p-8 rounded-[2rem] border border-slate-800 shadow-inner">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-4 block tracking-widest">1. Target Schema Object</label>
                        <select className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-5 text-white outline-none appearance-none cursor-pointer focus:border-cyan-500"
                            onChange={e => setSelectedTable(e.target.value)} value={selectedTable}>
                            <option value="">Awaiting selection...</option>
                            {schema && Object.keys(schema).map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>

                    <div className="bg-slate-950 p-8 rounded-[2rem] border border-slate-800 shadow-inner">
                        <label className="text-xs font-bold text-slate-500 uppercase mb-4 block tracking-widest">2. Isolation Scope</label>
                        <div className="flex gap-4 mb-6">
                            {['SINGLE', 'RANGE', 'LIST'].map(m => (
                                <button key={m} onClick={() => setMode(m)} 
                                    className={`flex-1 py-3 rounded-xl font-bold transition-all ${mode === m ? 'bg-cyan-600 text-white shadow-lg shadow-cyan-500/20' : 'bg-slate-900 text-slate-500 hover:text-slate-300'}`}>
                                    {m}
                                </button>
                            ))}
                        </div>
                        {mode === 'SINGLE' && <input className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-5 text-white" placeholder="Target Primary Key ID" value={singleId} onChange={e => setSingleId(e.target.value)} />}
                        {mode === 'RANGE' && (
                            <div className="flex gap-4">
                                <input className="w-1/2 bg-slate-900 border border-slate-700 rounded-2xl p-5 text-white" placeholder="Start ID (Int)" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
                                <input className="w-1/2 bg-slate-900 border border-slate-700 rounded-2xl p-5 text-white" placeholder="End ID (Int)" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
                            </div>
                        )}
                        {mode === 'LIST' && <input className="w-full bg-slate-900 border border-slate-700 rounded-2xl p-5 text-white" placeholder="e.g. user_01, user_02, user_09" value={listIds} onChange={e => setListIds(e.target.value)} />}
                    </div>
                </div>

                <button onClick={handlePrepare} disabled={loading || !selectedTable} className="w-full mt-10 bg-cyan-600 text-white py-6 rounded-3xl font-black text-xl hover:bg-cyan-500 transition-all shadow-xl disabled:opacity-50 disabled:cursor-not-allowed">
                    {loading ? "ISOLATING RECORDS..." : "VERIFY SCOPE"}
                </button>
            </div>
          )}

          {/* STEP 3: STRATEGY PREVIEW (Deep Introspection Hardened) */}
          {step === 3 && targetDetails.length > 0 ? (
            <div className="flex flex-col h-full animate-in zoom-in-95 duration-500 w-full">
                <div className="flex justify-between items-center mb-8">
                    <h2 className="text-4xl font-black text-white">Strategy Preview</h2>
                    <span className="bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest">{targetIds.length} Target Signatures</span>
                </div>

                <div className="bg-slate-950 rounded-[2rem] border border-slate-800 overflow-hidden flex-grow mb-8 flex flex-col shadow-2xl">
                    <div className="bg-slate-900/50 p-4 text-[10px] uppercase font-black text-slate-500 border-b border-slate-800 flex justify-between">
                        <span>Introspection Engine v4.6 Active</span>
                        {/* Optional chaining protects against schema or targetDetails missing data */}
                        <span>Sample Identifier: {targetDetails[0]?.[schema?.[selectedTable]?.primary_key] || "N/A"}</span>
                    </div>
                    <div className="overflow-y-auto flex-grow custom-scrollbar">
                        <table className="w-full text-left">
                            <thead className="sticky top-0 bg-slate-950 text-slate-500 text-[10px] uppercase font-black shadow-lg">
                                <tr>
                                    <th className="p-6">Field Descriptor</th>
                                    <th className="p-6">Analysis Reasoning</th>
                                    <th className="p-6">Protocol Logic</th>
                                    <th className="p-6">Simulation</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-900 font-mono text-xs text-white">
                                {schema?.[selectedTable]?.columns.map((col) => {
                                    const action = col.suggested_strategy;
                                    return (
                                        <tr key={col.name} className={`hover:bg-slate-900/30 transition-colors ${action !== 'IGNORE' && action !== 'PRESERVE' ? 'bg-cyan-500/5' : 'opacity-40'}`}>
                                            <td className="p-6 font-bold text-slate-300">{col.name}</td>
                                            <td className="p-6 italic text-slate-500 text-[10px]">{col.reason}</td>
                                            <td className="p-6">
                                                <span className={`px-3 py-1 rounded-md text-[9px] font-black uppercase tracking-tighter ${
                                                    action === 'HASH' ? 'bg-red-500/10 text-red-500 border border-red-500/20' :
                                                    action === 'EMAIL_MASK' ? 'bg-blue-500/10 text-blue-500 border border-blue-500/20' :
                                                    action === 'MASK' ? 'bg-yellow-500/10 text-yellow-500 border border-yellow-500/20' :
                                                    'bg-slate-800 text-slate-500'
                                                }`}>
                                                    {action}
                                                </span>
                                            </td>
                                            <td className="p-6">
                                                {action === 'HASH' && <span className="text-red-500/50 blur-[2px]">AGS_v3_SHA256</span>}
                                                {action === 'EMAIL_MASK' && <span className="text-blue-400 font-bold">REDACTED_***@host.com</span>}
                                                {action === 'MASK' && <span className="text-yellow-400 font-bold">***-***-1234</span>}
                                                {(action === 'PRESERVE' || action === 'IGNORE') && <span className="text-slate-600 uppercase tracking-tighter text-[9px]">Preserved State</span>}
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="flex gap-4">
                    <button onClick={() => setStep(2)} className="px-10 py-5 rounded-2xl bg-slate-800 font-bold hover:bg-slate-700 transition-all text-white border border-slate-700">Back</button>
                    <button onClick={handleExecuteProtocol} className="flex-1 py-5 rounded-2xl bg-red-600 font-black text-xl hover:bg-red-500 transition-all shadow-[0_0_40px_rgba(220,38,38,0.3)] uppercase tracking-widest text-white">
                        Commit Protocol
                    </button>
                </div>
            </div>
          ) : step === 3 && (
            <div className="flex flex-col items-center justify-center h-full text-center py-20 w-full">
                <div className="text-7xl mb-6">⚠️</div>
                <h2 className="text-3xl font-black text-white mb-2">Scope Identification Failed</h2>
                <p className="text-slate-500 max-w-sm font-medium">The target identifier set returned zero results from the remote cluster.</p>
                <button onClick={() => setStep(2)} className="mt-8 px-10 py-4 bg-slate-800 rounded-2xl font-bold text-cyan-400 border border-slate-700 hover:bg-slate-700 transition-all">Reconfigure Isolation</button>
            </div>
          )}

          {/* STEP 4: JOB PROGRESS (10/10 Architecture) */}
          {(activeJobId || step === 4) && (
            <div className="flex flex-col items-center justify-center h-full text-center animate-in fade-in zoom-in duration-500 w-full">
                {jobStatus?.status !== 'completed' && jobStatus?.status !== 'failed' ? (
                    <>
                        <div className="relative w-56 h-56 mb-10">
                            <svg className="w-full h-full transform -rotate-90">
                                <circle cx="112" cy="112" r="100" stroke="currentColor" strokeWidth="10" fill="transparent" className="text-slate-800" />
                                <circle cx="112" cy="112" r="100" stroke="currentColor" strokeWidth="10" fill="transparent" 
                                    strokeDasharray={628} strokeDashoffset={628 - (628 * (jobStatus?.progress || 0)) / 100} 
                                    className="text-cyan-500 transition-all duration-700 ease-out shadow-[0_0_20px_rgba(6,182,212,0.5)]" strokeLinecap="round" />
                            </svg>
                            <div className="absolute inset-0 flex items-center justify-center flex-col">
                                <span className="text-5xl font-black text-white">{jobStatus?.progress || 0}%</span>
                                <span className="text-[10px] text-slate-500 uppercase font-black tracking-[0.2em] mt-1">Hashed</span>
                            </div>
                        </div>
                        <h2 className="text-3xl font-black text-white mb-2 uppercase tracking-tighter">Executing Cryptographic Erasure</h2>
                        <p className="text-slate-500 font-mono text-sm max-w-sm uppercase leading-relaxed">
                            Job ID: <span className="text-cyan-500">{activeJobId?.slice(0,18)}...</span><br/>
                            Status: <span className="text-white">{jobStatus?.status?.replace('_', ' ') || 'Initializing'}</span>
                        </p>
                    </>
                ) : jobStatus?.status === 'failed' ? (
                    <div className="max-w-md">
                        <div className="text-7xl mb-6">❌</div>
                        <h2 className="text-3xl font-black text-white mb-2 uppercase">Protocol Aborted</h2>
                        <p className="text-red-400 font-mono text-sm mb-10 bg-red-900/10 p-4 rounded-xl border border-red-900/30 shadow-inner">
                            {jobStatus?.error || "Fatal Interruption during background task execution."}
                        </p>
                        <button onClick={() => {setStep(2); setActiveJobId(null); setJobStatus(null);}} className="bg-slate-800 text-white px-10 py-4 rounded-2xl font-bold border border-slate-700">Re-initiate Protocol</button>
                    </div>
                ) : (
                    <div className="animate-in zoom-in duration-700">
                        <div className="w-32 h-32 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center text-6xl mx-auto mb-8 border border-green-500/30 shadow-[0_0_50px_rgba(34,197,94,0.2)]">✓</div>
                        <h2 className="text-5xl font-black text-white mb-4 tracking-tighter">PROTOCOL SUCCESS</h2>
                        <p className="text-slate-400 mb-10 text-lg max-w-md mx-auto">The sovereignty node has completed the hashing cycle. All multi-tenant audit logs have been synchronized.</p>
                        <div className="flex gap-4 justify-center">
                            <button onClick={downloadResults} className="bg-white text-slate-900 px-10 py-5 rounded-3xl font-black text-lg hover:bg-cyan-400 transition-all shadow-2xl">DOWNLOAD CERTIFICATES</button>
                            <button onClick={() => {setStep(1); setActiveJobId(null); setJobStatus(null); setTargetIds([]); setTargetDetails([]);}} className="bg-slate-800 text-white px-10 py-5 rounded-3xl font-bold hover:bg-slate-700 transition-all border border-slate-700">NEW BATCH</button>
                        </div>
                    </div>
                )}
            </div>
          )}

        </div>
      </div>
    </div>
  )
}
