const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, 'js/core/firebase.js');
let content = fs.readFileSync(FILE_PATH, 'utf-8');

// 1. loadSdk() - Remove RTDB import
content = content.replace(/import\(SDK_BASE \+ "firebase-database\.js"\),/g, '');
content = content.replace(/const \[app, auth, database, firestore\] = await Promise\.race/g, 'const [app, auth, firestore] = await Promise.race');
content = content.replace(/state\.sdk = \{ app, auth, database, firestore \};/g, 'state.sdk = { app, auth, firestore };');
content = content.replace(/state\.rtdbHelpers = database;/g, '');

// 2. initCloud() - Remove getDatabase
content = content.replace(/state\.rtdb = sdk\.database\.getDatabase\(state\.app\);/g, '');
content = content.replace(/try \{ state\.sdk\.database\.goOnline\(state\.rtdb\); \} catch \{\}/g, '');
content = content.replace(/try \{ state\.sdk\.database\.goOffline\(state\.rtdb\); \} catch \{\}/g, '');

// 3. startListeners() - Replace listen function
content = content.replace(/const \{ ref, onChildAdded, onChildChanged, onChildRemoved, onValue, query: rtdbQuery, orderByChild, equalTo, get \} = database;/g, '');
content = content.replace(/const listen = \(col, rtdbQueryObj, fsQueryObj\) => \{[\s\S]*?window\.cicLazyListen = \(col\) => listen\(col\);/m, 
`const listen = (col, fsQueryObj) => {
    if (_deniedCollections.has(col)) return;
    if (FIRESTORE_COLLECTIONS.includes(col)) {
      const q = fsQueryObj || collection(state.fs, col);
      const unsub = onSnapshot(q, (snapshot) => {
        snapshot.docChanges().forEach((change) => {
          if (change.type === "added" || change.type === "modified") {
            db.applyRemote(col, change.doc.id, { ...change.doc.data(), id: change.doc.data().id || change.doc.id });
          }
          if (change.type === "removed") {
            db.applyRemote(col, change.doc.id, null);
          }
        });
      }, (err) => {
        const { errorCode, errorMsg, status } = classifyError(err);
        if (status === "denied") {
          if (_deniedCollections.has(col)) return;
          _deniedCollections.add(col);
        }
        syncLog({ db: "FS", col, path: col, op: "listen", status, errorCode, errorMsg });
      });
      _fsListenerCount++;
      _listenerUnsubs.push(() => { _fsListenerCount--; unsub(); });
    }
  };

  window.cicLazyListen = (col) => listen(col);`);

// 4. setupBaseCollections loop
content = content.replace(/RTDB_COLLECTIONS\.concat\(FIRESTORE_COLLECTIONS\)\.forEach/g, 'FIRESTORE_COLLECTIONS.forEach');
content = content.replace(/listen\(col, ref\(state\.rtdb, col\), collection\(state\.fs, col\)\);/g, 'listen(col, collection(state.fs, col));');

// 5. Replace rtdbQuery with fsQuery in role blocks
content = content.replace(/listen\("([^"]+)", rtdbQuery\(ref\(state\.rtdb, "[^"]+"\), orderByChild\("([^"]+)"\), equalTo\(([^)]+)\)\)(?:, fsQuery\([^)]+\))?\);/g, 
  'listen("$1", fsQuery(collection(state.fs, "$1"), where("$2", "==", $3)));');

// Special cases for staff, classId loops where the fsQuery was missing or trailing
content = content.replace(/listen\("([^"]+)", rtdbQuery\(ref\(state\.rtdb, "[^"]+"\), orderByChild\("([^"]+)"\), equalTo\(([^)]+)\)\), fsQuery\(collection\(state\.fs, "[^"]+"\), where\("[^"]+", "==", [^)]+\)\)\);/g, 
  'listen("$1", fsQuery(collection(state.fs, "$1"), where("$2", "==", $3)));');

// 6. refreshCloudData
content = content.replace(/const \{ ref, get \} = state\.sdk\.database;/g, '');
content = content.replace(/let count = 0;\s*try \{\s*if \(FIRESTORE_COLLECTIONS\.includes\(col\)\) \{[\s\S]*?\} else \{[\s\S]*?const snap = await get\(ref\(state\.rtdb, col\)\);[\s\S]*?\}\s*\} catch \(err\) \{/g,
`let count = 0;
      try {
        if (FIRESTORE_COLLECTIONS.includes(col)) {
          const q = limit ? query(collection(state.fs, col), _limit(fsLimit(col))) : collection(state.fs, col);
          const snap = await getDocs(q);
          snap.forEach(doc => {
            db.applyRemote(col, doc.id, { ...doc.data(), id: doc.id });
            count++;
          });
        }
        syncLog({ db: "FS", col, path: col, op: "refresh", status: "ok" });
      } catch (err) {`);
      
content = content.replace(/try \{\s*if \(FIRESTORE_COLLECTIONS\.includes\(col\)\) \{[\s\S]*?\} else \{[\s\S]*?const snap = await get\(ref\(state\.rtdb, col\)\);[\s\S]*?\}\s*\} catch \(err\) \{/g,
`try {
        if (FIRESTORE_COLLECTIONS.includes(col)) {
          const snap = await getDocs(collection(state.fs, col));
          snap.forEach(doc => { db.applyRemote(col, doc.id, { ...doc.data(), id: doc.id }); });
        }
        syncLog({ db: "FS", col, path: col, op: "bg-refresh", status: "ok" });
      } catch (err) {`);

// 7. syncHandler
content = content.replace(/const \{ ref, set, remove, get \} = state\.sdk\.database;/g, '');
content = content.replace(/if \(FIRESTORE_COLLECTIONS\.includes\(op\.col\)\) \{[\s\S]*?\} else \{[\s\S]*?const rtdbRef = ref\(state\.rtdb, path\);[\s\S]*?\}\s*syncLog\(\{ db: FIRESTORE_COLLECTIONS\.includes\(op\.col\) \? "FS" : "RTDB"/g,
`if (FIRESTORE_COLLECTIONS.includes(op.col)) {
        const docRef = doc(state.fs, op.col, op.id);
        if (op.action === "remove") {
          await deleteDoc(docRef);
        } else {
          await setDoc(docRef, op.data, { merge: true });
        }
        syncLog({ db: "FS", col: op.col, path, op: op.action, status: "ok" });
      } else {
        syncLog({ db: "FS", col: op.col, path, op: op.action, status: "ok" }); // Fallback
      }
      syncLog({ db: "FS"`);

// 8. bootstrapAdmin
content = content.replace(/const rtdbUserRef\s*=\s*ref\(state\.rtdb, "users\/" \+ uid\);[\s\S]*?status: "ok" \}\);\s*\}/g, '');
content = content.replace(/const rtdbRoleRef\s*=\s*ref\(state\.rtdb, "userRoles\/" \+ uid\);[\s\S]*?status: "ok" \}\);\s*\}/g, '');

// 9. Counters
content = content.replace(/export async function incrementCloudCounter\(name, val = 1\) \{[\s\S]*?\}\s*catch \(e\) \{/g,
`export async function incrementCloudCounter(name, val = 1) {
  if (state.mode !== "cloud" || !state.ready) return;
  try {
    const { doc, setDoc, increment } = state.sdk.firestore;
    await setDoc(doc(state.fs, "counters", name), { value: increment(val) }, { merge: true });
  } catch (e) {`);

content = content.replace(/export async function setCloudCounter\(name, value\) \{[\s\S]*?\}\s*catch \(e\) \{/g,
`export async function setCloudCounter(name, value) {
  if (state.mode !== "cloud" || !state.ready) return;
  try {
    const { doc, setDoc } = state.sdk.firestore;
    await setDoc(doc(state.fs, "counters", name), { value }, { merge: true });
  } catch (e) {`);

content = fs.writeFileSync(FILE_PATH, content, 'utf-8');
console.log("Refactor script complete!");
