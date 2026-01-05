import { useState } from 'react'
import logo from './assets/logo.png' 

export default function App() {
  const [token, setToken] = useState(null)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const [step, setStep] = useState(1)
  // NEW: SSL Flag in state
  const [dbCreds, setDbCreds] = useState({ 
      db_name: '', 
      user: 'postgres', 
      password: 'root', 
      host: 'localhost', 
      port: '5432',
      ssl_enabled: false 
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
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState([])

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true)
    const formData = new FormData();
    formData.append('username', username);
    formData.append('password', password);

    try {
        const res = await fetch('http://127.0.0.1:8000/token', {
            method: 'POST', body: formData
        })
        if (!res.ok) throw new Error("Invalid Credentials");
        const data = await res.json();
        setToken(data.access_token);
    } catch(err) {
        alert("Login Failed: " + err.message);
    }
    setLoading(false)
  }

  const authFetch = async (url, options) => {
      const headers = options.headers || {};
      headers['Authorization'] = `Bearer ${token}`;
      headers['Content-Type'] = 'application/json';
      return fetch(url, { ...options, headers });
  }

  const getPkCol = () => {
      if (!schema || !selectedTable) return '';
      const pk = schema[selectedTable].primary_key;
      return pk !== "UNKNOWN" ? pk : schema[selectedTable].columns[0].name;
  }

  const handleConnect = async () => {
    if(!dbCreds.db_name) { alert("Enter DB Name"); return; }
    setLoading(true)
    try {
      const res = await authFetch('http://127.0.0.1:8000/scan-target', {
        method: 'POST', body: JSON.stringify(dbCreds)
      })
      if (!res.ok) throw new Error("Connection Failed / Unauthorized")
      const data = await res.json()
      setSchema(data.schema)
      setStep(2)
      setLog(p => [...p, `✅ Connected to [${dbCreds.db_name}]`])
    } catch (e) { alert(e.message) }
    setLoading(false)
  }

  const handlePrepare = async () => {
    if (!selectedTable) { alert("Select Table"); return; }
    let ids = [];

    if (mode === 'SINGLE') {
        if (!singleId) { alert("Enter ID"); return; }
        ids.push(singleId.trim());
    } 
    else if (mode === 'RANGE') {
        const start = parseInt(rangeStart);
        const end = parseInt(rangeEnd);
        if (isNaN(start) || isNaN(end)) { alert("Range mode requires Integer IDs"); return; }
        if ((end - start) > 1000) { alert("Max 1000 records"); return; }
        for (let i = start; i <= end; i++) ids.push(String(i));
    } 
    else if (mode === 'LIST') {
        ids = listIds.split(',').map(x => x.trim()).filter(x => x !== '');
    }

    if (ids.length === 0) { alert("No valid IDs"); return; }
    
    setLoading(true)
    try {
        const res = await authFetch('http://127.0.0.1:8000/fetch-batch-details', {
            method: 'POST', body: JSON.stringify({
                connection: dbCreds,
                table_name: selectedTable,
                primary_key_col: getPkCol(),
                target_ids: ids
            })
        })
        const data = await res.json()
        
        if (data && data.length > 0) {
            setTargetIds(ids)
            setTargetDetails(data)
            setStep(3)
            setLog(p => [...p, `🔍 Retrieved ${data.length} records`])
        } else {
            alert(`No records found using PK '${getPkCol()}'`)
        }
    } catch (e) { alert(e.message) }
    setLoading(false)
  }

  const handleExecute = async () => {
    if(!confirm(`Proceed with erasure of ${targetIds.length} records?`)) return;

    setLoading(true)
    const pkCol = getPkCol();
    
    const colsToClean = schema[selectedTable].columns
      .filter(col => col.suggested_strategy !== 'IGNORE' && col.suggested_strategy !== 'PRESERVE')
      .map(col => ({ 
          col: col.name, 
          strategy: col.suggested_strategy
      }))

    try {
        const res = await fetch('http://127.0.0.1:8000/execute-erasure', {
          method: 'POST', 
          headers: { 
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json' 
          },
          body: JSON.stringify({
            connection: dbCreds,
            target_table: selectedTable,
            target_id_col: pkCol,
            target_ids: targetIds,
            columns_to_clean: colsToClean
          })
        })

        if (res.ok) {
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `AEGIS_Batch.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setStep(4)
        } else { alert("Server Error or Unauthorized") }
    } catch (e) { alert(e.message) }
    setLoading(false)
  }

  if (!token) {
      return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center font-sans">
            <div className="bg-slate-800 p-8 rounded-xl shadow-2xl border border-slate-700 w-96 text-center">
                <img src={logo} alt="Logo" className="w-20 h-20 mx-auto mb-4 object-contain" />
                <h1 className="text-2xl font-bold text-white mb-6">AEGIS <span className="text-cyan-500">IAM</span></h1>
                <form onSubmit={handleLogin} className="space-y-4">
                    <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white" 
                        placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
                    <input className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white" type="password"
                        placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
                    <button type="submit" disabled={loading} className="w-full bg-cyan-600 hover:bg-cyan-500 py-3 rounded text-white font-bold">
                        {loading ? "Authenticating..." : "Secure Login"}
                    </button>
                </form>
                <p className="text-xs text-slate-500 mt-4">Restricted Access. Authorized Personnel Only.</p>
            </div>
        </div>
      )
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-4 gap-6">
        
        {/* SIDEBAR */}
        <div className="col-span-1 space-y-6">
            <div className="border-b border-slate-700 pb-6 flex flex-col items-center text-center">
            <img src={logo} alt="Aegis Logo" className="w-24 h-24 mb-4 object-contain" />
            <h1 className="text-3xl font-black tracking-tight text-white">AEGIS <span className="text-cyan-500">v3.0</span></h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Cloud Connectivity</p>
            <div className="mt-4 text-xs text-green-400 border border-green-600 px-2 py-1 rounded bg-green-900/20">
                Logged in as: {username}
            </div>
            <button onClick={() => setToken(null)} className="text-xs text-red-400 mt-2 underline">Logout</button>
          </div>
          
          <div className="bg-black/50 rounded border border-slate-800 p-2 font-mono text-[10px] h-48 overflow-y-auto">
            {log.map((l, i) => <div key={i} className="mb-1 text-purple-400">{l}</div>)}
          </div>

          <div className={`p-4 rounded border transition-all ${step === 1 ? 'border-purple-500 bg-slate-800' : 'border-green-500 bg-slate-900'}`}>
            <h3 className="font-bold mb-2">1. System Link</h3>
            {step === 1 ? (
                <>
                    {/* SSL CHECKBOX */}
                    <div className="flex items-center gap-2 mb-3 bg-slate-900 p-2 rounded border border-slate-700">
                        <input type="checkbox" checked={dbCreds.ssl_enabled} 
                            onChange={e => setDbCreds({...dbCreds, ssl_enabled: e.target.checked})} 
                            className="cursor-pointer" />
                        <label className="text-[10px] text-slate-300 font-bold">ENABLE CLOUD SSL</label>
                    </div>

                    <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white" 
                        placeholder="Database Name..." value={dbCreds.db_name} onChange={e => setDbCreds({...dbCreds, db_name: e.target.value})} 
                    />
                    <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white" 
                        placeholder="Host (e.g. aws.amazon.com)" value={dbCreds.host} onChange={e => setDbCreds({...dbCreds, host: e.target.value})} 
                    />
                    <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white" 
                        placeholder="User" value={dbCreds.user} onChange={e => setDbCreds({...dbCreds, user: e.target.value})} 
                    />
                    <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white" type="password"
                        placeholder="Password" value={dbCreds.password} onChange={e => setDbCreds({...dbCreds, password: e.target.value})} 
                    />

                    <button onClick={handleConnect} disabled={loading} className="w-full bg-purple-600 hover:bg-purple-500 text-xs py-3 rounded font-bold">
                        {loading ? "Establishing Uplink..." : "Connect"}
                    </button>
                </>
            ) : (
                <button onClick={() => setStep(1)} className="w-full border border-slate-600 text-slate-400 text-xs py-2 rounded">Disconnect</button>
            )}
          </div>
        </div>

        {/* MAIN PANEL */}
        <div className="col-span-3 bg-slate-800/30 border border-slate-700 rounded-xl p-8 relative min-h-[500px] flex flex-col">
          
          {step < 2 && (
            <div className="flex flex-col items-center justify-center flex-grow text-slate-600 opacity-50">
                <div className="text-8xl mb-6 grayscale opacity-20">☁️</div>
                <div className="text-2xl font-bold uppercase">Cloud Link Active</div>
            </div>
          )}

          {/* STEP 2: SELECTION */}
          {step === 2 && (
             <div className="animate-in slide-in-from-right duration-300">
                <h2 className="text-3xl font-bold text-white mb-6">Target Configuration</h2>
                
                <div className="mb-6">
                    <label className="text-xs uppercase text-slate-400 font-bold">Target Table</label>
                    <select className="w-full bg-slate-900 border border-slate-600 rounded p-3 mt-1 text-white"
                        onChange={e => setSelectedTable(e.target.value)} value={selectedTable}>
                        <option value="">Select Table...</option>
                        {schema && Object.keys(schema).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>

                <div className="flex gap-2 mb-6 border-b border-slate-700">
                    {['SINGLE', 'RANGE', 'LIST'].map(m => (
                        <button key={m} onClick={() => setMode(m)} 
                            className={`px-4 py-2 text-sm font-bold ${mode === m ? 'text-purple-400 border-b-2 border-purple-400' : 'text-slate-500'}`}>
                            {m}
                        </button>
                    ))}
                </div>

                <div className="bg-slate-900 p-6 rounded border border-slate-700 mb-6">
                    {mode === 'SINGLE' && (
                        <input className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                            placeholder="Enter ID..." value={singleId} onChange={e => setSingleId(e.target.value)} />
                    )}
                    {mode === 'RANGE' && (
                        <div className="flex gap-4">
                            <input className="w-1/2 bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                                placeholder="Start Int" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
                            <input className="w-1/2 bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                                placeholder="End Int" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
                        </div>
                    )}
                    {mode === 'LIST' && (
                        <input className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                            placeholder="e.g. user_01, user_02" value={listIds} onChange={e => setListIds(e.target.value)} />
                    )}
                </div>

                <button onClick={handlePrepare} disabled={loading} className="px-8 py-4 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold w-full shadow-lg">
                    {loading ? "Verifying Targets..." : `Initialize ${mode} Protocol`}
                </button>
             </div>
          )}

          {/* STEP 3: PREVIEW */}
          {step === 3 && (
            <div className="animate-in fade-in zoom-in duration-300 flex flex-col h-full">
                <div className="flex justify-between items-end mb-6">
                    <h2 className="text-3xl font-bold text-white">Strategy Preview</h2>
                    <div className="text-xs text-purple-400 border border-purple-500 px-3 py-1 rounded bg-purple-900/20">
                        {targetDetails.length} RECORDS
                    </div>
                </div>

                <div className="bg-slate-900 rounded border border-slate-600 mb-6 overflow-hidden">
                    <div className="bg-black/50 p-2 text-[10px] uppercase font-bold text-slate-500 border-b border-slate-700 text-center">
                        Simulating Protocol on Sample Record (ID: {targetDetails[0][getPkCol()]})
                    </div>
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase">
                            <tr>
                                <th className="p-3">Column</th>
                                <th className="p-3">Sample Data</th>
                                <th className="p-3">Applied Strategy</th>
                                <th className="p-3">Result</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 font-mono text-xs">
                            {schema[selectedTable].columns.map((col) => {
                                const val = targetDetails[0][col.name];
                                const action = col.suggested_strategy;
                                return (
                                    <tr key={col.name} className={action !== 'IGNORE' && action !== 'PRESERVE' ? 'bg-red-900/10' : ''}>
                                        <td className="p-3 text-slate-400">{col.name}</td>
                                        <td className="p-3 text-white max-w-xs truncate">{val}</td>
                                        <td className="p-3">
                                            {action === 'HASH' && (
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded w-fit">SALTED HASH</span>
                                                    <span className="text-[9px] text-red-300 mt-1 italic">{col.reason}</span>
                                                </div>
                                            )}
                                            {action === 'EMAIL_MASK' && (
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold bg-blue-600 text-white px-2 py-1 rounded w-fit">EMAIL MASK</span>
                                                    <span className="text-[9px] text-blue-300 mt-1 italic">{col.reason}</span>
                                                </div>
                                            )}
                                            {action === 'MASK' && (
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold bg-yellow-600 text-white px-2 py-1 rounded w-fit">PARTIAL MASK</span>
                                                    <span className="text-[9px] text-yellow-300 mt-1 italic">{col.reason}</span>
                                                </div>
                                            )}
                                            {action === 'PRESERVE' && (
                                                <div className="flex flex-col">
                                                    <span className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded w-fit">PRESERVE</span>
                                                    <span className="text-[9px] text-green-300 mt-1 italic">{col.reason}</span>
                                                </div>
                                            )}
                                            {action === 'IGNORE' && <span className="text-[10px] text-slate-600 border border-slate-700 px-2 py-1 rounded">IGNORE</span>}
                                        </td>
                                        <td className="p-3">
                                            {action === 'HASH' && <span className="text-red-400 blur-[2px]">HASH_VAL</span>}
                                            {action === 'EMAIL_MASK' && <span className="text-blue-400">redacted@gmail.com</span>}
                                            {action === 'MASK' && <span className="text-yellow-400">***-***-1234</span>}
                                            {(action === 'PRESERVE' || action === 'IGNORE') && <span className="text-slate-600">NO CHANGE</span>}
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                </div>

                <div className="flex gap-4 mt-auto">
                    <button onClick={() => setStep(2)} className="px-8 py-4 rounded bg-slate-700 hover:bg-slate-600 text-white font-bold">Back</button>
                    <button onClick={handleExecute} className="px-8 py-4 rounded bg-red-600 hover:bg-red-500 text-white font-bold flex-1 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
                        COMMIT PROTOCOL
                    </button>
                </div>
            </div>
          )}

          {/* STEP 4: SUCCESS */}
          {step === 4 && (
            <div className="text-center py-20 animate-in fade-in zoom-in duration-500">
              <div className="text-8xl mb-6">🔒</div>
              <h2 className="text-4xl font-bold text-white mb-2">Protocol Complete</h2>
              <button onClick={() => {setStep(2); setTargetIds([])}} className="bg-purple-600 px-10 py-4 rounded text-white font-bold shadow-lg mt-8">
                Next Batch
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}