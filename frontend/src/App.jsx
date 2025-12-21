import { useState } from 'react'
import logo from './assets/logo.png' 

export default function App() {
  // --- STATE ---
  const [step, setStep] = useState(1) // 1:Connect, 2:Scan, 3:Search, 4:Preview, 5:Result
  
  // DEFAULT CREDS (Password/User hardcoded for convenience, but DB Name is now dynamic)
  const [dbCreds, setDbCreds] = useState({ 
    db_name: '', // <--- FETCHES FROM INPUT
    user: 'postgres', 
    password: 'root', 
    host: 'localhost', 
    port: '5432' 
  })
  
  const [schema, setSchema] = useState(null)
  const [selectedTable, setSelectedTable] = useState('')
  const [searchId, setSearchId] = useState('')
  const [victimData, setVictimData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState([])

  // Helper to find ID column
  const getIdCol = () => schema[selectedTable] ? schema[selectedTable][0].name : '';

  // --- HANDLERS ---

  // 1. CONNECT
  const handleConnect = async () => {
    if(!dbCreds.db_name) { alert("Please enter a Database Name"); return; }
    setLoading(true)
    try {
      const res = await fetch('http://127.0.0.1:8000/scan-target', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dbCreds)
      })
      if (!res.ok) throw new Error("Connection Refused. Check DB Name/Password.")
      const data = await res.json()
      setSchema(data.schema)
      setStep(2)
      setLog(p => [...p, `✅ Connected to [${dbCreds.db_name}]`, `🧠 Smart Schema Analyzed`])
    } catch (e) {
      alert(e.message)
      setLog(p => [...p, `❌ Connection Failed: ${dbCreds.db_name}`])
    }
    setLoading(false)
  }

  // 2. DISCONNECT (NEW FEATURE)
  const handleDisconnect = () => {
    setStep(1)
    setSchema(null)
    setSelectedTable('')
    setSearchId('')
    setVictimData(null)
    setLog(p => [...p, `🔌 Disconnected from [${dbCreds.db_name}]`])
    //keep the dbCreds in the state for easy reconnection 
   
  }

  // 3. SEARCH
  const handleSearch = async () => {
    setLoading(true)
    if (!selectedTable) return;
    const res = await fetch('http://127.0.0.1:8000/search-victim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection: dbCreds,
        table_name: selectedTable,
        primary_key_col: getIdCol(),
        search_id: parseInt(searchId)
      })
    })
    const data = await res.json()
    if (data.found) {
      setVictimData(data.data)
      setStep(3)
      setLog(p => [...p, `🔍 Target Located: ID ${searchId}`])
    } else {
      alert("ID not found in this table")
    }
    setLoading(false)
  }

  // 4. EXECUTE & DOWNLOAD REPORT
  const handleExecute = async () => {
    setLoading(true)
    const idCol = getIdCol();
    
    const colsToClean = schema[selectedTable]
      .filter(col => col.suggested_strategy === 'HASH')
      .map(col => ({ col: col.name, strategy: 'HASH' }))

    if(colsToClean.length === 0) {
        alert("No PII detected. Nothing to clean.");
        setLoading(false);
        return;
    }

    try {
        const res = await fetch('http://127.0.0.1:8000/execute-erasure', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connection: dbCreds,
            target_table: selectedTable,
            target_id_col: idCol,
            target_id_val: parseInt(searchId),
            columns_to_clean: colsToClean
          })
        })

        if (res.ok) {
          // HANDLE PDF DOWNLOAD
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `Erasure_Certificate_${searchId}.pdf`;
          document.body.appendChild(a);
          a.click();
          a.remove();

          setStep(5)
          setLog(p => [...p, `💀 PROTOCOL EXECUTED`, `📄 Certificate Downloaded`, `📝 Audit Log Updated`])
        } else {
            alert("Error executing protocol")
        }
    } catch (e) {
        alert(e.message)
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-4 gap-6">
        
        {/* LEFT CONTROLS SIDEBAR */}
        <div className="col-span-1 space-y-6">
          
          {/* HEADER WITH LOGO */}
          <div className="border-b border-slate-700 pb-6 flex flex-col items-center text-center">
            <img 
              src={logo} 
              alt="Aegis Logo" 
              className="w-24 h-24 mb-4 object-contain drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]" 
            />
            <h1 className="text-3xl font-black tracking-tight text-white">
              AEGIS <span className="text-cyan-500">v2.2</span>
            </h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">
              Smart Sovereignty Engine
            </p>
          </div>
          
          {/* LOG WINDOW */}
          <div className="bg-black/50 rounded border border-slate-800 p-2 font-mono text-[10px] h-48 overflow-y-auto">
            {log.map((l, i) => <div key={i} className="mb-1 text-cyan-400">{l}</div>)}
          </div>

          {/* CONTROL PANEL 1: CONNECTION */}
          <div className={`p-4 rounded border transition-all ${step === 1 ? 'border-cyan-500 bg-slate-800' : 'border-green-500 bg-slate-900'}`}>
            <h3 className="font-bold mb-2 flex justify-between items-center">
                1. Target System
                {step > 1 && <span className="text-[10px] bg-green-500 text-black px-1 rounded">CONNECTED</span>}
            </h3>
            
            {step === 1 ? (
                // VIEW: NOT CONNECTED
                <>
                    <label className="text-[10px] text-slate-400 uppercase">Database Name</label>
                    <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white focus:border-cyan-500 outline-none" 
                        placeholder="e.g. bank_db"
                        value={dbCreds.db_name} 
                        onChange={e => setDbCreds({...dbCreds, db_name: e.target.value})} 
                    />
                    
                    <label className="text-[10px] text-slate-400 uppercase">Host IP</label>
                    <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-slate-500" 
                        value={dbCreds.host} disabled 
                    />

                    <button onClick={handleConnect} disabled={loading} className="w-full bg-cyan-600 hover:bg-cyan-500 text-xs py-3 rounded font-bold transition-colors">
                        {loading ? "Establishing Link..." : "Initiate Connection"}
                    </button>
                </>
            ) : (
                // VIEW: CONNECTED
                <div className="text-center">
                    <div className="text-xl font-mono text-cyan-400 mb-2">{dbCreds.db_name}</div>
                    <button onClick={handleDisconnect} className="w-full border border-slate-600 hover:bg-slate-800 text-slate-400 text-xs py-2 rounded transition-colors">
                        Change Target Database
                    </button>
                </div>
            )}
          </div>

          {/* CONTROL PANEL 2: SEARCH */}
          {step >= 2 && (
             <div className={`p-4 rounded border animate-in slide-in-from-left duration-500 ${step === 2 ? 'border-cyan-500 bg-slate-800' : 'border-slate-700 opacity-50'}`}>
                <h3 className="font-bold mb-2">2. Vector Search</h3>
                <select className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white outline-none"
                    onChange={e => setSelectedTable(e.target.value)} value={selectedTable}>
                    <option value="">Select Table...</option>
                    {schema && Object.keys(schema).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white outline-none" 
                    placeholder="Primary Key ID..."
                    value={searchId} onChange={e => setSearchId(e.target.value)} 
                />
                {step === 2 && (
                    <button onClick={handleSearch} disabled={loading} className="w-full bg-blue-600 hover:bg-blue-500 text-xs py-3 rounded font-bold transition-colors">
                        {loading ? "Scanning..." : "Run Deep Scan"}
                    </button>
                )}
             </div>
          )}
        </div>

        {/* RIGHT DISPLAY AREA */}
        <div className="col-span-3 bg-slate-800/30 border border-slate-700 rounded-xl p-8 relative min-h-[500px] flex flex-col">
          
          {/* IDLE STATE */}
          {step < 3 && (
            <div className="flex flex-col items-center justify-center flex-grow text-slate-600 opacity-50">
                <div className="text-8xl mb-6 grayscale opacity-20">🛡️</div>
                <div className="text-2xl font-bold tracking-widest uppercase">Awaiting Target Acquisition</div>
                <div className="text-sm font-mono mt-2">Ready to interface with local PostgreSQL clusters</div>
            </div>
          )}

          {/* ACTIVE STATE (SIMULATION) */}
          {(step === 3 || step === 4) && victimData && (
            <div className="animate-in fade-in zoom-in duration-300">
              <div className="flex justify-between items-end mb-6">
                <h2 className="text-3xl font-bold text-white">Simulation Mode</h2>
                <div className="text-xs text-yellow-500 border border-yellow-500 px-3 py-1 rounded bg-yellow-900/20 animate-pulse font-mono">
                    ⚠️ DRY RUN ACTIVE
                </div>
              </div>

              {/* DATA TABLE */}
              <div className="bg-slate-900 rounded border border-slate-600 mb-8 overflow-hidden shadow-2xl">
                 <table className="w-full text-left text-sm">
                    <thead className="bg-black text-slate-400 uppercase text-[10px] tracking-wider">
                        <tr>
                            <th className="p-4">Column Name</th>
                            <th className="p-4">Current Value</th>
                            <th className="p-4">AI Strategy</th>
                            <th className="p-4">Result Preview</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 font-mono">
                        {schema[selectedTable].map((col) => {
                             const val = victimData[col.name];
                             const action = col.suggested_strategy;
                             
                             if (val === undefined) return null;

                             return (
                                <tr key={col.name} className={`transition-colors ${action === 'HASH' ? 'bg-red-900/10 hover:bg-red-900/20' : 'hover:bg-slate-800/50'}`}>
                                    <td className="p-4 text-slate-400">{col.name}</td>
                                    <td className="p-4 text-white max-w-xs truncate">{val}</td>
                                    <td className="p-4">
                                        {action === 'HASH' && <span className="text-[10px] font-bold bg-red-600 text-white px-2 py-1 rounded">ERASE (PII)</span>}
                                        {action === 'PRESERVE' && <span className="text-[10px] font-bold bg-green-600 text-white px-2 py-1 rounded">PRESERVE</span>}
                                        {action === 'IGNORE' && <span className="text-[10px] text-slate-600 border border-slate-700 px-2 py-1 rounded">IGNORE</span>}
                                    </td>
                                    <td className="p-4">
                                        {action === 'HASH' ? (
                                            <span className="text-red-400 blur-[2px] hover:blur-none transition-all cursor-crosshair">HASH_xxxxxxxx</span>
                                        ) : (
                                            <span className="text-green-500/50 text-[10px]">NO CHANGE</span>
                                        )}
                                    </td>
                                </tr>
                             )
                        })}
                    </tbody>
                 </table>
              </div>

              {/* ACTION BUTTONS */}
              <div className="flex gap-4">
                <button onClick={() => {setStep(2); setVictimData(null)}} className="px-8 py-4 rounded bg-slate-700 hover:bg-slate-600 text-white font-bold transition-colors">
                  Abort & Return
                </button>
                <button onClick={handleExecute} className="px-8 py-4 rounded bg-red-600 hover:bg-red-500 text-white font-bold flex-1 shadow-[0_0_20px_rgba(220,38,38,0.5)] transition-all hover:scale-[1.01]">
                  CONFIRM & COMMIT PROTOCOL
                </button>
              </div>
            </div>
          )}

          {/* COMPLETED STATE */}
          {step === 5 && (
            <div className="text-center py-20 animate-in fade-in zoom-in duration-500">
              <div className="text-8xl mb-6 drop-shadow-[0_0_15px_rgba(34,197,94,0.5)]">✅</div>
              <h2 className="text-4xl font-bold text-white mb-4">Sanitization Complete</h2>
              <div className="bg-black/40 inline-block p-6 rounded-lg border border-slate-700 mb-8 max-w-lg mx-auto">
                 <p className="text-slate-300 mb-2 font-mono text-sm">Target Identity has been cryptographically hashed.</p>
                 <p className="text-slate-500 text-xs">Transaction history & Business analytics data have been preserved in accordance with Data Sovereignty laws.</p>
              </div>
              <br/>
              <button onClick={() => {setStep(2); setVictimData(null)}} className="bg-cyan-600 hover:bg-cyan-500 px-10 py-4 rounded text-white font-bold shadow-lg transition-colors">
                Process Next Target
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}