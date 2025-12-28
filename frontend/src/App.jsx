import { useState } from 'react'
import logo from './assets/logo.png' 

export default function App() {
  const [step, setStep] = useState(1)
  const [dbCreds, setDbCreds] = useState({ db_name: '', user: 'postgres', password: 'root', host: 'localhost', port: '5432' })
  const [schema, setSchema] = useState(null)
  const [selectedTable, setSelectedTable] = useState('')
  
  const [mode, setMode] = useState('SINGLE') 
  const [singleId, setSingleId] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [listIds, setListIds] = useState('')
  
  const [targetIds, setTargetIds] = useState([]) 
  const [targetDetails, setTargetDetails] = useState([]) // NEW: Stores actual row data
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState([])

  const getIdCol = () => schema[selectedTable] ? schema[selectedTable][0].name : '';

  // 1. CONNECT
  const handleConnect = async () => {
    if(!dbCreds.db_name) { alert("Enter DB Name"); return; }
    setLoading(true)
    try {
      const res = await fetch('http://127.0.0.1:8000/scan-target', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(dbCreds)
      })
      if (!res.ok) throw new Error("Connection Failed")
      const data = await res.json()
      setSchema(data.schema)
      setStep(2)
      setLog(p => [...p, `✅ Connected to [${dbCreds.db_name}]`])
    } catch (e) { alert(e.message) }
    setLoading(false)
  }

// 2. PREPARE & FETCH PREVIEW (DEBUGGED VERSION)
  const handlePrepare = async () => {
    // FIX 1: Alert if table is missing instead of failing silently
    if (!selectedTable) { 
        alert("⚠️ Please select a Target Table from the dropdown first."); 
        return; 
    }

    let ids = [];

    // LOGIC: Calculate IDs based on Mode
    try {
        if (mode === 'SINGLE') {
            if (!singleId) { alert("Please enter an ID."); return; }
            ids.push(parseInt(singleId));
        } 
        else if (mode === 'RANGE') {
            const start = parseInt(rangeStart);
            const end = parseInt(rangeEnd);
            if (isNaN(start) || isNaN(end)) { alert("Please enter valid numbers for Start and End."); return; }
            if (start > end) { alert("Start ID cannot be greater than End ID."); return; }
            
            // Limit range to prevent browser crash
            if ((end - start) > 1000) { alert("Range too large. Max 1000 records at a time."); return; }
            
            for (let i = start; i <= end; i++) ids.push(i);
        } 
        else if (mode === 'LIST') {
            if (!listIds.trim()) { alert("Please enter a list of IDs (e.g., 1, 5, 10)."); return; }
            
            // FIX 2: Better parsing for List Mode
            ids = listIds.split(',')
                .map(x => x.trim())       // Remove spaces
                .filter(x => x !== '')    // Remove empty strings
                .map(x => parseInt(x))    // Convert to Integer
                .filter(x => !isNaN(x));  // Remove non-numbers
        }
    } catch (err) {
        alert("Error parsing inputs: " + err.message);
        return;
    }

    // FIX 3: Check if IDs array is empty after parsing
    if (ids.length === 0) { 
        alert("No valid IDs found. Please check your input format."); 
        return; 
    }
    
    console.log("Requesting IDs:", ids); // Debugging Log (Check F12 Console)
    setLoading(true)
    
    // NEW: Fetch Actual Data for these IDs
    try {
        const res = await fetch('http://127.0.0.1:8000/fetch-batch-details', {
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                connection: dbCreds,
                table_name: selectedTable,
                primary_key_col: getIdCol(),
                target_ids: ids
            })
        })
        
        if (!res.ok) {
            throw new Error(`Server Error: ${res.status}`);
        }

        const data = await res.json()
        
        if (data && data.length > 0) {
            setTargetIds(ids)
            setTargetDetails(data) // Store details for display
            setStep(3)
            setLog(p => [...p, `🔍 Retrieved ${data.length} records for preview`])
        } else {
            alert(`No records found. The IDs [${ids.join(', ')}] do not exist in table '${selectedTable}'.`)
        }
    } catch (e) { 
        alert("Fetch Error: " + e.message);
        console.error(e);
    }
    
    setLoading(false)
  }

  // 3. EXECUTE
  const handleExecute = async () => {
    if(!confirm(`WARNING: About to anonymize ${targetIds.length} records. Proceed?`)) return;

    setLoading(true)
    const idCol = getIdCol();
    
    const colsToClean = schema[selectedTable]
      .filter(col => col.suggested_strategy === 'HASH')
      .map(col => ({ col: col.name, strategy: 'HASH' }))

    try {
        const res = await fetch('http://127.0.0.1:8000/execute-erasure', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            connection: dbCreds,
            target_table: selectedTable,
            target_id_col: idCol,
            target_ids: targetIds,
            columns_to_clean: colsToClean
          })
        })

        if (res.ok) {
          // DOWNLOAD FILE (ZIP or PDF)
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          // Determine extension based on count
          a.download = targetIds.length === 1 ? `Certificate_ID_${targetIds[0]}.pdf` : `AEGIS_Batch.zip`;
          document.body.appendChild(a);
          a.click();
          a.remove();

          setStep(4)
          setLog(p => [...p, `💀 PROTOCOL EXECUTED`, `📄 Evidence Downloaded`])
        } else {
            alert("Server Error")
        }
    } catch (e) { alert(e.message) }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 font-sans p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-4 gap-6">
        
        {/* SIDEBAR */}
        <div className="col-span-1 space-y-6">
            <div className="border-b border-slate-700 pb-6 flex flex-col items-center text-center">
            <img src={logo} alt="Aegis Logo" className="w-24 h-24 mb-4 object-contain drop-shadow-[0_0_10px_rgba(6,182,212,0.5)]" />
            <h1 className="text-3xl font-black tracking-tight text-white">AEGIS <span className="text-purple-500">v2.5</span></h1>
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mt-1">Bulk Operations Module</p>
          </div>
          
          <div className="bg-black/50 rounded border border-slate-800 p-2 font-mono text-[10px] h-48 overflow-y-auto">
            {log.map((l, i) => <div key={i} className="mb-1 text-purple-400">{l}</div>)}
          </div>

          <div className={`p-4 rounded border transition-all ${step === 1 ? 'border-purple-500 bg-slate-800' : 'border-green-500 bg-slate-900'}`}>
            <h3 className="font-bold mb-2">1. System Link</h3>
            {step === 1 ? (
                <>
                    <input className="w-full bg-slate-950 border border-slate-700 rounded p-2 text-sm mb-3 text-white" 
                        placeholder="Database Name..." value={dbCreds.db_name} onChange={e => setDbCreds({...dbCreds, db_name: e.target.value})} 
                    />
                    <button onClick={handleConnect} disabled={loading} className="w-full bg-purple-600 hover:bg-purple-500 text-xs py-3 rounded font-bold">
                        {loading ? "Linking..." : "Connect"}
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
                <div className="text-8xl mb-6 grayscale opacity-20">📚</div>
                <div className="text-2xl font-bold uppercase">Batch Processing Ready</div>
            </div>
          )}

          {/* STEP 2: SELECTION MODE */}
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
                            {m} ENTRY
                        </button>
                    ))}
                </div>

                <div className="bg-slate-900 p-6 rounded border border-slate-700 mb-6">
                    {mode === 'SINGLE' && (
                        <input className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                            placeholder="Enter Single ID..." value={singleId} onChange={e => setSingleId(e.target.value)} />
                    )}
                    {mode === 'RANGE' && (
                        <div className="flex gap-4">
                            <input className="w-1/2 bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                                placeholder="Start ID (e.g. 1)" value={rangeStart} onChange={e => setRangeStart(e.target.value)} />
                            <input className="w-1/2 bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                                placeholder="End ID (e.g. 100)" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} />
                        </div>
                    )}
                    {mode === 'LIST' && (
                        <input className="w-full bg-slate-800 border border-slate-600 rounded p-3 text-white" 
                            placeholder="IDs (e.g. 1, 5, 12)" value={listIds} onChange={e => setListIds(e.target.value)} />
                    )}
                </div>

                <button onClick={handlePrepare} disabled={loading} className="px-8 py-4 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold w-full shadow-lg">
                    {loading ? "Verifying Targets..." : `Initialize ${mode} Protocol`}
                </button>
             </div>
          )}

          {/* STEP 3: PREVIEW (NEW SCROLLABLE LIST) */}
          {step === 3 && (
            <div className="animate-in fade-in zoom-in duration-300 flex flex-col h-full">
                <div className="flex justify-between items-end mb-6">
                    <h2 className="text-3xl font-bold text-white">Batch Confirmation</h2>
                    <div className="text-xs text-purple-400 border border-purple-500 px-3 py-1 rounded bg-purple-900/20">
                        {targetDetails.length} RECORDS FOUND
                    </div>
                </div>

                {/* SCROLLABLE DATA PREVIEW */}
                <div className="flex-grow bg-slate-900 rounded border border-slate-700 mb-6 overflow-hidden flex flex-col max-h-[400px]">
                    <div className="bg-black/50 p-3 text-xs uppercase font-bold text-slate-400 border-b border-slate-700">
                        Data Snapshot (Pre-Erasure)
                    </div>
                    <div className="overflow-y-auto p-4 space-y-3">
                        {targetDetails.map((row, idx) => (
                            <div key={idx} className="bg-slate-800/50 p-3 rounded border border-slate-700/50 flex flex-col text-sm">
                                <div className="flex justify-between text-slate-500 text-xs mb-1">
                                    <span>#{idx+1}</span>
                                    <span>ID: {row[getIdCol()]}</span>
                                </div>
                                <div className="text-white font-mono break-all">
                                    {/* Show the first 3 relevant fields like Name/Email */}
                                    {Object.entries(row).slice(1, 4).map(([k, v]) => (
                                        <span key={k} className="mr-4"><span className="text-purple-400">{k}:</span> {v}</span>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="flex gap-4 mt-auto">
                    <button onClick={() => setStep(2)} className="px-8 py-4 rounded bg-slate-700 hover:bg-slate-600 text-white font-bold">Back</button>
                    <button onClick={handleExecute} className="px-8 py-4 rounded bg-red-600 hover:bg-red-500 text-white font-bold flex-1 shadow-[0_0_20px_rgba(220,38,38,0.5)]">
                        COMMIT ERASURE
                    </button>
                </div>
            </div>
          )}

          {/* STEP 4: SUCCESS */}
          {step === 4 && (
            <div className="text-center py-20 animate-in fade-in zoom-in duration-500">
              <div className="text-8xl mb-6">📦</div>
              <h2 className="text-4xl font-bold text-white mb-2">Operation Complete</h2>
              <p className="text-slate-400 mb-8">
                  {targetDetails.length} records processed.<br/>
                  Evidence file downloaded.
              </p>
              <button onClick={() => {setStep(2); setTargetIds([])}} className="bg-purple-600 px-10 py-4 rounded text-white font-bold shadow-lg">
                Start New Batch
              </button>
            </div>
          )}

        </div>
      </div>
    </div>
  )
}