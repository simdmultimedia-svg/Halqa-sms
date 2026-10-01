import { el } from "../core/utils.js";
import { btn } from "../core/ui.js";
import { getState as getSupabaseState } from "../core/supabase.js";
import { getCurrentUser } from "../core/auth.js";

export function render(container) {
  const st = getSupabaseState();
  const user = getCurrentUser();

  const getQueueSize = () => {
    try {
      return JSON.parse(localStorage.getItem("CIC KANO:__syncqueue") || "[]").length;
    } catch {
      return 0;
    }
  };

  container.innerHTML = "";
  
  const header = el("div", { className: "mb-6 flex justify-between items-center" }, [
    el("h2", { className: "text-2xl font-semibold text-gray-800", text: "🏥 System Health Check" }),
    btn("Refresh", { variant: "secondary", onclick: () => render(container) })
  ]);
  
  const tableEl = el("table", { className: "min-w-full divide-y divide-gray-200 border rounded-md overflow-hidden bg-white shadow-sm" });
  
  const addRow = (name, value, status = "info") => {
    let colorClass = "text-gray-700";
    if (status === "ok") colorClass = "text-green-600 font-medium";
    if (status === "error") colorClass = "text-red-600 font-bold";
    if (status === "warn") colorClass = "text-yellow-600 font-medium";
    
    tableEl.appendChild(
      el("tr", { className: "hover:bg-gray-50" }, [
        el("td", { className: "px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 border-b", text: name }),
        el("td", { className: `px-4 py-3 whitespace-nowrap text-sm border-b ${colorClass}`, text: value })
      ])
    );
  };
  
  const isOnline = navigator.onLine;
  addRow("Network Connection", isOnline ? "Online" : "Offline", isOnline ? "ok" : "warn");
  
  const currentMode = st.mode;
  addRow("Current Backend", currentMode === "cloud" ? "Supabase (Cloud)" : "Local Storage (Offline)", currentMode === "cloud" ? "ok" : "warn");
  
  const supabaseConnection = st.ready ? "Connected" : "Disconnected/Pending";
  addRow("Supabase SDK Status", supabaseConnection, st.ready ? "ok" : "warn");
  
  const authStatus = user ? `Authenticated (${user.email})` : "Not Authenticated";
  addRow("Authentication Status", authStatus, user ? "ok" : "error");

  const rbacRole = user?.role || "None";
  addRow("RBAC Role", rbacRole, rbacRole !== "None" ? "ok" : "warn");
  
  const queueSize = getQueueSize();
  addRow("Offline Sync Queue", queueSize === 0 ? "Empty (Fully synced)" : `${queueSize} operations pending`, queueSize === 0 ? "ok" : "warn");

  const realtimeStatus = (st.client && st.client.realtime && st.client.realtime.isConnected()) ? "Connected" : "Disconnected";
  addRow("Realtime Socket", realtimeStatus, realtimeStatus === "Connected" ? "ok" : "warn");
  
  let indexedDBStatus = "Checking...";
  const idbRow = el("tr", { className: "hover:bg-gray-50" }, [
    el("td", { className: "px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 border-b", text: "IndexedDB (Local Cache)" }),
    el("td", { className: "px-4 py-3 whitespace-nowrap text-sm border-b text-gray-500", id: "idb-status", text: indexedDBStatus })
  ]);
  tableEl.appendChild(idbRow);

  let edgeFunctionStatus = "Pinging...";
  const edgeRow = el("tr", { className: "hover:bg-gray-50" }, [
    el("td", { className: "px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 border-b", text: "Edge Functions (create-user)" }),
    el("td", { className: "px-4 py-3 whitespace-nowrap text-sm border-b text-gray-500", id: "edge-status", text: edgeFunctionStatus })
  ]);
  tableEl.appendChild(edgeRow);
  
  container.appendChild(header);
  container.appendChild(tableEl);
  
  // Test IndexedDB asynchronously
  try {
      const request = indexedDB.open("CICKANO_v2_TEST", 1);
      request.onsuccess = (e) => {
          const db = e.target.result;
          db.close();
          const cell = container.querySelector("#idb-status");
          if(cell) {
             cell.textContent = "Operational";
             cell.className = "px-4 py-3 whitespace-nowrap text-sm border-b text-green-600 font-medium";
          }
      };
      request.onerror = (e) => {
          const cell = container.querySelector("#idb-status");
          if (cell) {
              cell.textContent = "Failed/Blocked";
              cell.className = "px-4 py-3 whitespace-nowrap text-sm border-b text-red-600 font-bold";
          }
      };
  } catch(e) {
      const cell = container.querySelector("#idb-status");
      if (cell) {
          cell.textContent = "Error: " + e.message;
          cell.className = "px-4 py-3 whitespace-nowrap text-sm border-b text-red-600 font-bold";
      }
  }

  // Test Edge Function
  if (st.client) {
      st.client.functions.invoke('create-user', {
          body: {} // Send empty body to test connectivity
      }).then(({ data, error }) => {
          const cell = container.querySelector("#edge-status");
          if (cell) {
              // We expect a 400 Bad Request or 401 Unauthorized since we didn't send credentials,
              // which proves the function is reachable and running.
              if (error && (error.message.includes("Failed to fetch") || error.message.includes("NetworkError"))) {
                  cell.textContent = "Unreachable (Network/CORS Error)";
                  cell.className = "px-4 py-3 whitespace-nowrap text-sm border-b text-red-600 font-bold";
              } else {
                  // Function responded, meaning it is alive
                  cell.textContent = "Operational & Responding";
                  cell.className = "px-4 py-3 whitespace-nowrap text-sm border-b text-green-600 font-medium";
              }
          }
      }).catch(err => {
          const cell = container.querySelector("#edge-status");
          if (cell) {
              cell.textContent = "Error: " + err.message;
              cell.className = "px-4 py-3 whitespace-nowrap text-sm border-b text-red-600 font-bold";
          }
      });
  } else {
      const cell = container.querySelector("#edge-status");
      if (cell) {
          cell.textContent = "Supabase client not ready";
          cell.className = "px-4 py-3 whitespace-nowrap text-sm border-b text-yellow-600 font-medium";
      }
  }
}
