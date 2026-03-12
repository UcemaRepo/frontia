const API_URL = "https://backendia-khz7.onrender.com";

// ── Estado global ──────────────────────────────────────────────────────
let username     = localStorage.getItem("username");
let activeView   = "personal"; // "personal" | "dm:<user>" | "channel:<id>"
let myEventTs    = 0;
let mirrorUser   = null;
let mirrorCount  = 0;
let mirrorTimer  = null;
let dmUnread     = {};
let chUnread     = {};  // { channel_id: count }
let newChannelAI = true;  // toggle en modal de creación
let lastActivity  = Date.now();
let pendingFiles  = [];    // [{ name, type, size, dataURL }, ...]

if (!username) {
  username = prompt("Ingresá tu nombre de usuario");
  if (username) localStorage.setItem("username", username.trim());
  else location.reload();
}
document.getElementById("username").textContent = username;

// ── Arranque ────────────────────────────────────────────────────────────
sendHeartbeat();
setInterval(sendHeartbeat, 20000);
setInterval(loadUsers,     5000);
setInterval(loadChannels,  6000);
setInterval(pollEvents,    2500);

loadUsers();
loadChannels();
renderPersonal();

["mousemove","keydown","click","scroll"].forEach(ev =>
  document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true })
);

window.addEventListener("beforeunload", () =>
  navigator.sendBeacon(API_URL + "/offline",
    new Blob([JSON.stringify({ user: username })], { type: "application/json" }))
);

// ── Heartbeat ───────────────────────────────────────────────────────────
async function sendHeartbeat() {
  if (!username) return;
  fetch(API_URL + "/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: username, active: Date.now() - lastActivity < 300000 })
  }).catch(() => {});
}

// ── Input ───────────────────────────────────────────────────────────────
const msgInput = document.getElementById("messageInput");
msgInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 120) + "px";
});
msgInput.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
});

async function handleSend() {
  const msg   = msgInput.value.trim();
  const files = [...pendingFiles];
  if (!msg && !files.length) return;
  msgInput.value = "";
  msgInput.style.height = "auto";
  clearPendingFiles();

  if      (activeView === "personal")              await sendToAI(msg, files);
  else if (activeView.startsWith("dm:"))           await sendDM(activeView.slice(3), msg, files);
  else if (activeView.startsWith("channel:"))      await sendToChannel(activeView.slice(8), msg, files);
}

// ══════════════════════════════════════════════════════════════════════
// VISTAS
// ══════════════════════════════════════════════════════════════════════

// ── 1. Chat personal ──────────────────────────────────────────────────
async function renderPersonal() {
  activeView = "personal";
  setNavActive("nav-personal");
  setHeader(
    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
    "Mi chat", "Chat personal con el agente IA",
    `<button class="btn-ghost-sm" onclick="deleteMyChat()" title="Borrar historial">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H5L4,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
    </button>`
  );
  msgInput.placeholder = "Escribí un mensaje para el agente...";
  const area = getArea();
  area.innerHTML = "";
  try {
    const hist = await apiFetch("/history/" + username);
    hist.forEach(m => { addUserBubble(area, m.message, username); addBotBubble(area, m.reply); });
    scrollBottom(area);
  } catch (_) {}
}

async function sendToAI(message, files) {
  const area = getArea();
  addUserBubble(area, message || "", username, files);
  const loader = addLoader(area);
  const fileDesc = files.length ? files.map(f => "[archivo: " + f.name + "]").join(" ") : "";
  try {
    const data = await apiFetch("/chat", "POST", { message: message || fileDesc, user: username, personality: getPersonality() });
    loader.remove(); addBotBubble(area, data.reply);
  } catch (_) { loader.remove(); addBotBubble(area, "Error al conectar."); }
}

async function deleteMyChat() {
  if (!confirm("¿Borrar todo tu historial?")) return;
  await apiFetch("/delete/" + username, "DELETE");
  if (activeView === "personal") getArea().innerHTML = "";
}

// ── 2. DM directo ─────────────────────────────────────────────────────
async function renderDM(otherUser) {
  activeView = "dm:" + otherUser;
  setNavActive("nav-user-" + otherUser);

  dmUnread[otherUser] = 0;
  const badge = document.getElementById("dm-badge-" + otherUser);
  if (badge) badge.style.display = "none";

  setHeader(
    `<div class="dm-header-avatar">${otherUser[0].toUpperCase()}</div>`,
    otherUser,
    "Mensaje directo · sin IA",
    `<button class="btn-icon-sm" onclick="loadMirror('${otherUser}')" title="Ver chat con IA">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
    </button>`
  );
  msgInput.placeholder = `Mensaje directo a ${otherUser}...`;

  const area = getArea();
  area.innerHTML = `
    <div class="dm-start-banner">
      <div class="dm-start-avatar">${otherUser[0].toUpperCase()}</div>
      <div class="dm-start-name">${otherUser}</div>
      <div class="dm-start-sub">Inicio de tu conversación directa con <strong>${otherUser}</strong>. La IA no participa aquí.</div>
    </div>
  `;

  try {
    const msgs = await apiFetch(`/dm/${otherUser}?user=${encodeURIComponent(username)}`);
    msgs.forEach(m => addDMBubble(area, m.message, m.from, m.from === username, m.ts, m.files || []));
    scrollBottom(area);
  } catch (_) {}
}

async function sendDM(otherUser, message, files) {
  const fileDesc = files.length ? files.map(f => "[archivo: " + f.name + "]").join(" ") : "";
  const text = message || fileDesc;
  addDMBubble(getArea(), message, username, true, null, files);
  try {
    // Enviar archivos como base64 al backend para que lleguen al otro usuario
    const filesPayload = files.map(f => ({ name: f.name, type: f.type, dataURL: f.dataURL }));
    await apiFetch(`/dm/${otherUser}`, "POST", { from: username, message: text, files: filesPayload });
  } catch (_) { showToast("Error al enviar"); }
}

// ── 3. Canal ──────────────────────────────────────────────────────────
async function renderChannel(channelId) {
  activeView = "channel:" + channelId;
  setNavActive("nav-ch-" + channelId);
  chUnread[channelId] = 0;
  const badge = document.getElementById("ch-badge-" + channelId);
  if (badge) { badge.style.display = "none"; badge.dataset.n = 0; }

  let ch;
  try { ch = await apiFetch("/channels/" + channelId); } catch (_) { return; }

  setHeader(
    `<span class="channel-hash">#</span>`, ch.name, `Canal · creado por ${ch.creator}`,
    ch.creator === username
      ? `<button class="btn-danger-sm" onclick="deleteChannel('${channelId}')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H5L4,6"/></svg>
          Borrar</button>` : ""
  );
  msgInput.placeholder = `Escribir en #${ch.name}...`;
  const area = getArea();
  area.innerHTML = "";
  (ch.messages || []).forEach(m => { addUserBubble(area, m.message, m.actor, m.files || []); if (m.reply) addBotBubble(area, m.reply); });
  scrollBottom(area);
}

async function sendToChannel(channelId, message, files) {
  const area = getArea();
  const fileDesc = files.length ? files.map(f => "[archivo: " + f.name + "]").join(" ") : "";
  addUserBubble(area, message, username, files);
  const loader = addLoader(area);
  try {
    const filesPayload = files.map(f => ({ name: f.name, type: f.type, dataURL: f.dataURL }));
    const data = await apiFetch(`/channels/${channelId}/chat`, "POST",
      { message: message || fileDesc, user: username, personality: getPersonality(), files: filesPayload });
    loader.remove();
    if (data.reply) addBotBubble(area, data.reply);
  } catch (_) { loader.remove(); addBotBubble(area, "Error."); }
}

async function deleteChannel(channelId) {
  if (!confirm("¿Borrar este canal permanentemente?")) return;
  await apiFetch("/channels/" + channelId, "DELETE", { user: username });
  renderPersonal(); loadChannels();
}

// ══════════════════════════════════════════════════════════════════════
// POLLING — maneja eventos sin tocar el área principal salvo que corresponda
// ══════════════════════════════════════════════════════════════════════
async function pollEvents() {
  if (!username) return;
  try {
    const events = await apiFetch(`/events/${username}?since=${myEventTs}`);
    events.forEach(handleEvent);
  } catch (_) {}
}

function handleEvent(ev) {
  myEventTs = Math.max(myEventTs, ev.ts);
  switch (ev.type) {

    case "dm":
      if (activeView === "dm:" + ev.actor) {
        addDMBubble(getArea(), ev.message, ev.actor, false, null, ev.files || []);
      } else {
        dmUnread[ev.actor] = (dmUnread[ev.actor] || 0) + 1;
        const b = document.getElementById("dm-badge-" + ev.actor);
        if (b) { b.textContent = dmUnread[ev.actor] > 9 ? "9+" : dmUnread[ev.actor]; b.style.display = "inline-flex"; }
        const preview = ev.files && ev.files.length ? `📎 ${ev.files.length} archivo(s)` : ev.message.slice(0, 50);
        showToast(`💬 ${ev.actor}: ${preview}`);
      }
      break;

    case "channel_created":
      if (ev.actor !== username) { loadChannels(); showToast(`${ev.actor} creó #${ev.channel_name}`); }
      break;

    case "channel_deleted":
      loadChannels();
      if (activeView === "channel:" + ev.channel_id) { renderPersonal(); showToast("El canal fue borrado"); }
      break;

    case "channel_message":
      if (ev.actor === username) break;
      if (activeView === "channel:" + ev.channel_id) {
        addUserBubble(getArea(), ev.message, ev.actor, ev.files || []);
        if (ev.reply) addBotBubble(getArea(), ev.reply);
      } else {
        chUnread[ev.channel_id] = (chUnread[ev.channel_id] || 0) + 1;
        const b = document.getElementById("ch-badge-" + ev.channel_id);
        if (b) { const n = chUnread[ev.channel_id]; b.textContent = n > 9 ? "9+" : n; b.dataset.n = n; b.style.display = "inline-flex"; }
      }
      break;

    case "mirror_update":
      // SOLO va al panel espejo derecho — nunca al área principal
      if (ev.actor === mirrorUser) appendToMirror(ev.message, ev.reply);
      break;
  }
}

// ══════════════════════════════════════════════════════════════════════
// SIDEBAR
// ══════════════════════════════════════════════════════════════════════
async function loadUsers() {
  try {
    const users = await apiFetch("/users");
    const list  = document.getElementById("usersList");
    if (!list) return;
    const order = { online:0, away:1, offline:2 };
    users.sort((a,b) => order[a.status] - order[b.status]);
    list.innerHTML = "";
    users.filter(u => u.name !== username).forEach(u => list.appendChild(makeUserCard(u)));
  } catch (_) {}
}

function makeUserCard(u) {
  const el = document.createElement("div");
  el.id        = "nav-user-" + u.name;
  el.className = "sidebar-item user-item" + (activeView === "dm:" + u.name ? " active" : "");
  el.onclick   = () => renderDM(u.name);
  // Preservar badge count acumulado si existe
  const savedCount = dmUnread[u.name] || 0;
  const badgeStyle = savedCount > 0 ? "inline-flex" : "none";
  const badgeText  = savedCount > 9 ? "9+" : (savedCount || "");
  el.innerHTML = `
    <span class="status-dot ${u.status}"></span>
    <span class="item-label">${u.name}</span>
    <span class="dm-unread" id="dm-badge-${u.name}" style="display:${badgeStyle}">${badgeText}</span>
    <div class="user-item-actions">
      <button class="user-action-btn dm-btn" title="Mensaje directo" onclick="event.stopPropagation();renderDM('${u.name}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      </button>
      <button class="user-action-btn mirror-btn" title="Ver espejo" onclick="event.stopPropagation();loadMirror('${u.name}')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
      </button>
    </div>
  `;
  return el;
}

async function loadChannels() {
  try {
    const channels = await apiFetch("/channels");
    const list  = document.getElementById("channelsList");
    const empty = document.getElementById("channelsEmpty");
    if (!list) return;
    const ids = Object.keys(channels);
    if (empty) empty.style.display = ids.length ? "none" : "block";
    list.innerHTML = "";
    ids.forEach(id => {
      const ch = channels[id];
      const el = document.createElement("div");
      el.id        = "nav-ch-" + id;
      el.className = "sidebar-item" + (activeView === "channel:" + id ? " active" : "");
      el.onclick   = () => renderChannel(id);
      el.innerHTML = `
        <span class="channel-hash-sm">#</span>
        <span class="item-label">${ch.name}</span>
        <span class="channel-badge" id="ch-badge-${id}"
          style="display:${chUnread[id]>0?'inline-flex':'none'}"
          data-n="${chUnread[id]||0}">${chUnread[id]>9?'9+':(chUnread[id]||'')} </span>
        ${ch.creator === username
          ? `<button class="item-action danger" title="Borrar" onclick="event.stopPropagation();deleteChannel('${id}')">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H5L4,6"/></svg>
             </button>` : ""}
      `;
      list.appendChild(el);
    });
  } catch (_) {}
}

function setNavActive(id) {
  document.querySelectorAll(".sidebar-item").forEach(el => el.classList.remove("active"));
  const el = document.getElementById(id);
  if (el) el.classList.add("active");
}

// ══════════════════════════════════════════════════════════════════════
// PANEL ESPEJO — completamente independiente del área principal
// ══════════════════════════════════════════════════════════════════════
async function loadMirror(user) {
  stopMirrorTimer();
  mirrorUser  = user;
  mirrorCount = 0;
  const mc    = document.getElementById("mirrorChat");
  const me    = document.getElementById("mirrorEmpty");
  const eb    = document.getElementById("mirrorBtnExpand");
  if (!mc) return;
  mc.innerHTML = "";
  try {
    const hist = await apiFetch("/history/" + user);
    if (hist.length) {
      if (me) me.style.display = "none";
      hist.forEach(m => {
        const q = document.createElement("div"); q.className = "mirror-msg-user"; q.textContent = m.message;
        const a = document.createElement("div"); a.className = "mirror-msg-bot"; renderRichInto(a, m.reply);
        mc.appendChild(q); mc.appendChild(a);
      });
      mc.scrollTop = mc.scrollHeight;
      mirrorCount = hist.length;
    } else {
      if (me) { me.style.display = "flex"; me.querySelector("p").textContent = `${user} aún no tiene mensajes.`; }
    }
  } catch (_) {}
  if (eb) eb.style.display = "inline-flex";
  startMirrorTimer(user);
}

function appendToMirror(message, reply) {
  const mc = document.getElementById("mirrorChat");
  const me = document.getElementById("mirrorEmpty");
  if (!mc) return;
  if (me) me.style.display = "none";
  mirrorCount++;
  const q = document.createElement("div"); q.className = "mirror-msg-user mirror-new"; q.textContent = message;
  const a = document.createElement("div"); a.className = "mirror-msg-bot mirror-new"; renderRichInto(a, reply);
  mc.appendChild(q); mc.appendChild(a);
  mc.scrollTop = mc.scrollHeight;
}

function startMirrorTimer(user) {
  mirrorTimer = setInterval(async () => {
    try {
      const hist = await apiFetch("/history/" + user);
      if (hist.length > mirrorCount) {
        hist.slice(mirrorCount).forEach(m => appendToMirror(m.message, m.reply));
        mirrorCount = hist.length;
      }
    } catch (_) {}
  }, 2500);
}
function stopMirrorTimer() { if (mirrorTimer) { clearInterval(mirrorTimer); mirrorTimer = null; } }

// Vista expandida
function openExpandedView() {
  if (!mirrorUser) return;
  const existing = document.getElementById("expandedOverlay");
  if (existing) existing.remove();
  const overlay = document.createElement("div");
  overlay.id = "expandedOverlay"; overlay.className = "expanded-overlay";
  overlay.onclick = e => { if (e.target === overlay) closeExpandedView(); };
  overlay.innerHTML = `
    <div class="expanded-panel">
      <div class="expanded-header">
        <span class="panel-label">ESPEJO · ${mirrorUser.toUpperCase()}</span>
        <div style="display:flex;gap:6px">
          <button class="btn-icon-sm" onclick="refreshExpanded()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
          </button>
          <button class="btn-ghost-sm" onclick="closeExpandedView()">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="expanded-messages" id="expandedMessages"></div>
    </div>`;
  document.body.appendChild(overlay);
  refreshExpanded();
  overlay._poll = setInterval(refreshExpanded, 3000);
  requestAnimationFrame(() => overlay.classList.add("open"));
}
async function refreshExpanded() {
  try {
    const hist = await apiFetch("/history/" + mirrorUser);
    const c = document.getElementById("expandedMessages");
    if (!c) return;
    c.innerHTML = "";
    hist.forEach(m => {
      const u = document.createElement("div"); u.className = "expanded-bubble user"; u.textContent = m.message;
      const b = document.createElement("div"); b.className = "expanded-bubble bot"; renderRichInto(b, m.reply);
      c.appendChild(u); c.appendChild(b);
    });
    c.scrollTop = c.scrollHeight;
  } catch (_) {}
}
function closeExpandedView() {
  const el = document.getElementById("expandedOverlay");
  if (!el) return;
  if (el._poll) clearInterval(el._poll);
  el.classList.remove("open");
  setTimeout(() => el.remove(), 200);
}

// ══════════════════════════════════════════════════════════════════════
// RENDER — burbujas área principal
// ══════════════════════════════════════════════════════════════════════
function addUserBubble(container, text, actor, files) {
  const isMe = actor === username;
  const wrap = document.createElement("div");
  wrap.className = "msg-row " + (isMe ? "mine" : "theirs");
  if (!isMe) { const l = document.createElement("div"); l.className = "msg-actor"; l.textContent = actor; wrap.appendChild(l); }

  if (files && files.length) {
    files.forEach(f => wrap.appendChild(buildFileBubble(f, isMe)));
  }
  if (text) {
    const b = document.createElement("div"); b.className = "bubble user"; b.textContent = text;
    wrap.appendChild(b);
  }
  container.appendChild(wrap); scrollBottom(container);
}
function addBotBubble(container, raw) {
  const wrap = document.createElement("div"); wrap.className = "msg-row bot-row";
  const b    = document.createElement("div"); b.className = "bubble bot";
  renderRichInto(b, raw); wrap.appendChild(b); container.appendChild(wrap); scrollBottom(container);
}
function addLoader(container) {
  const d = document.createElement("div"); d.className = "msg-row bot-row";
  d.innerHTML = '<div class="bubble bot"><span class="loader-dot"></span></div>';
  container.appendChild(d); scrollBottom(container); return d;
}

// ── Burbujas DM ────────────────────────────────────────────────────────
function addDMBubble(container, text, from, isMe, ts) {
  const now  = ts || Date.now() / 1000;
  const prev = container.lastElementChild;
  const group = prev?.classList.contains("dm-group")
             && prev?.dataset?.author === from
             && (now - parseFloat(prev.dataset.ts || 0)) < 120;

  if (group) {
    const inner  = prev.querySelector(".dm-group-inner");
    const bubble = document.createElement("div");
    bubble.className = `dm-bubble ${isMe ? "dm-bubble-mine" : "dm-bubble-theirs"} dm-stacked`;
    bubble.textContent = text;
    inner.appendChild(bubble);
    prev.dataset.ts = now;
  } else {
    const wrap = document.createElement("div");
    wrap.className      = "dm-group " + (isMe ? "dm-group-mine" : "dm-group-theirs");
    wrap.dataset.author = from;
    wrap.dataset.ts     = now;

    if (!isMe) { const av = document.createElement("div"); av.className = "dm-avatar"; av.textContent = from[0].toUpperCase(); wrap.appendChild(av); }

    const inner = document.createElement("div"); inner.className = "dm-group-inner";
    if (!isMe) { const name = document.createElement("div"); name.className = "dm-sender"; name.textContent = from; inner.appendChild(name); }

    const bubble = document.createElement("div");
    bubble.className = `dm-bubble ${isMe ? "dm-bubble-mine" : "dm-bubble-theirs"}`;
    bubble.textContent = text;
    inner.appendChild(bubble);
    wrap.appendChild(inner);
    container.appendChild(wrap);
  }
  scrollBottom(container);
}

// ── Burbuja de archivo ────────────────────────────────────────────────
function buildFileBubble(file, isMe) {
  const wrap = document.createElement("div");
  wrap.className = "file-bubble " + (isMe ? "file-bubble-mine" : "file-bubble-theirs");

  const isImage = file.type && file.type.startsWith("image/");

  if (isImage && file.dataURL) {
    const img = document.createElement("img");
    img.src = file.dataURL;
    img.className = "file-bubble-img";
    img.onclick = () => window.open(file.dataURL, "_blank");
    wrap.appendChild(img);
  } else {
    const ext = file.name.split(".").pop().toUpperCase();
    wrap.innerHTML = `
      <div class="file-bubble-doc">
        <div class="file-bubble-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="file-bubble-info">
          <div class="file-bubble-name">${file.name}</div>
          <div class="file-bubble-ext">${ext} · ${file.size ? (file.size/1024).toFixed(1)+" KB" : ""}</div>
        </div>
      </div>
    `;
  }
  return wrap;
}

function clearPendingFiles() {
  pendingFiles = [];
  document.getElementById("fileUpload").value = "";
  const bar = document.getElementById("filePreviewBar");
  if (bar) bar.innerHTML = "";
}

// ── Rich content ────────────────────────────────────────────────────────
function renderRichInto(container, raw) {
  parseRich(raw).forEach(part => {
    if      (part.type === "text" && part.content.trim()) { const p = document.createElement("p"); p.className = "bot-text"; p.textContent = part.content.trim(); container.appendChild(p); }
    else if (part.type === "table")    container.appendChild(buildTable(part.content));
    else if (part.type === "widget")   container.appendChild(buildWidget(part.title, part.content));
    else if (part.type === "download") container.appendChild(buildDownload(part.filename, part.content));
  });
}
function parseRich(raw) {
  const parts = [], re = /<table>([\s\S]*?)<\/table>|<widget title="([^"]*)">([\s\S]*?)<\/widget>|<download filename="([^"]*)">([\s\S]*?)<\/download>/g;
  let last = 0, m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) parts.push({ type:"text", content: raw.slice(last, m.index) });
    if      (m[1]!==undefined) parts.push({ type:"table", content: m[1].trim() });
    else if (m[2]!==undefined) parts.push({ type:"widget", title: m[2], content: m[3].trim() });
    else if (m[4]!==undefined) parts.push({ type:"download", filename: m[4], content: m[5] });
    last = re.lastIndex;
  }
  if (last < raw.length) parts.push({ type:"text", content: raw.slice(last) });
  return parts;
}
function buildTable(raw) {
  const wrap = document.createElement("div"); wrap.className = "rich-table-wrap";
  const tbl  = document.createElement("table"); tbl.className = "rich-table";
  raw.split("\n").filter(l=>l.trim()).forEach((line,i) => {
    const row = document.createElement("tr");
    line.split("|").map(c=>c.trim()).forEach(cell => { const td = document.createElement(i===0?"th":"td"); td.textContent=cell; row.appendChild(td); });
    tbl.appendChild(row);
  });
  wrap.appendChild(tbl); return wrap;
}
function buildWidget(title, content) {
  const d = document.createElement("div"); d.className = "rich-widget";
  d.innerHTML = `<div class="widget-title">${title}</div><div class="widget-body">${content}</div>`; return d;
}
function buildDownload(filename, content) {
  const ext=filename.split(".").pop().toLowerCase(), binary=["docx","xlsx","pptx"].includes(ext);
  const fn=binary?filename.replace(/\.[^.]+$/,".txt"):filename;
  const mime={txt:"text/plain",csv:"text/csv",md:"text/markdown",json:"application/json",html:"text/html"}[fn.split(".").pop()]||"text/plain";
  const url=URL.createObjectURL(new Blob([content],{type:mime}));
  const d=document.createElement("div"); d.className="rich-download";
  d.innerHTML=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    <a href="${url}" download="${fn}" class="download-link">${fn}</a>
    <span class="download-size">${(content.length/1024).toFixed(1)} KB</span>
    ${binary?`<span class="download-warning">⚠ Convertido a .txt</span>`:""}`;
  return d;
}

// ══════════════════════════════════════════════════════════════════════
// MODALES
// ══════════════════════════════════════════════════════════════════════
function openCreateChannelModal() {
  newChannelAI = true;
  const btn = document.getElementById("aiToggleBtn");
  if (btn) btn.classList.add("active");
  document.getElementById("createChannelModal").classList.add("open");
  setTimeout(()=>document.getElementById("channelNameInput").focus(),50);
}
function closeCreateChannelModal() {
  document.getElementById("createChannelModal").classList.remove("open");
  document.getElementById("channelNameInput").value="";
}
function toggleAI() {
  newChannelAI = !newChannelAI;
  const btn = document.getElementById("aiToggleBtn");
  if (btn) btn.classList.toggle("active", newChannelAI);
}
async function createChannel() {
  const name = document.getElementById("channelNameInput").value.trim();
  if (!name) return;
  try {
    const data = await apiFetch("/channels","POST",{user:username,name,ai_enabled:newChannelAI});
    if (data.error){alert(data.error);return;}
    closeCreateChannelModal(); await loadChannels(); renderChannel(data.id);
  } catch(_){alert("Error al crear el canal");}
}
document.getElementById("createChannelModal").addEventListener("click",function(e){if(e.target===this)closeCreateChannelModal();});
document.getElementById("channelNameInput")?.addEventListener("keydown",e=>{if(e.key==="Enter")createChannel();});

const PRESET_LABELS={normal:"Normal",analyst:"Analista",creative:"Creativo",strict:"Estricto",dev:"Dev",coach:"Coach"};
async function loadPersonalityModal(){
  try{
    const data=await apiFetch("/personality/"+username);
    document.getElementById("customPersonality").value=data.custom||"";
    const chips=document.getElementById("presetChips"); chips.innerHTML="";
    Object.entries(data.presets||{}).forEach(([key,text])=>{const c=document.createElement("button");c.className="preset-chip";c.textContent=PRESET_LABELS[key]||key;c.onclick=()=>{document.getElementById("customPersonality").value=text;};chips.appendChild(c);});
  }catch(_){}
}
function openPersonalityModal(){document.getElementById("personalityModal").classList.add("open");loadPersonalityModal();}
function closePersonalityModal(){document.getElementById("personalityModal").classList.remove("open");}
async function savePersonality(){const custom=document.getElementById("customPersonality").value.trim();await apiFetch("/personality/"+username,"POST",{custom});if(custom)document.getElementById("personality").value="custom";closePersonalityModal();}
async function clearPersonality(){document.getElementById("customPersonality").value="";await apiFetch("/personality/"+username,"DELETE");}
document.getElementById("personalityModal").addEventListener("click",function(e){if(e.target===this)closePersonalityModal();});

async function uploadFile(){
  const fi = document.getElementById("fileUpload");
  if (!fi.files.length) return;

  for (const file of fi.files) {
    // Subir al backend
    const fd = new FormData(); fd.append("file", file); fd.append("user", username);
    const res = await fetch(API_URL + "/upload", { method:"POST", body:fd });
    if (!res.ok) { showToast(`"${file.name}" no es un tipo soportado`); continue; }

    // Leer como dataURL para preview y burbuja local
    const dataURL = await new Promise(resolve => {
      const r = new FileReader(); r.onload = e => resolve(e.target.result); r.readAsDataURL(file);
    });

    const fileObj = { name: file.name, type: file.type, size: file.size, dataURL };
    pendingFiles.push(fileObj);
    addFileChip(fileObj, pendingFiles.length - 1);
  }
  fi.value = "";
}

function addFileChip(fileObj, idx) {
  const bar = document.getElementById("filePreviewBar");
  const isImage = fileObj.type.startsWith("image/");
  const chip = document.createElement("div");
  chip.className = "file-chip";
  chip.dataset.idx = idx;
  chip.innerHTML = isImage
    ? `<img src="${fileObj.dataURL}" class="file-chip-thumb">`
    : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
  chip.innerHTML += `<span class="file-chip-name">${fileObj.name}</span>
    <button class="file-chip-rm" onclick="removeFileChip(${idx})">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>`;
  bar.appendChild(chip);
}

function removeFileChip(idx) {
  pendingFiles[idx] = null;
  const bar = document.getElementById("filePreviewBar");
  const chip = bar.querySelector(`[data-idx="${idx}"]`);
  if (chip) chip.remove();
  pendingFiles = pendingFiles.filter(Boolean);
  // re-index
  bar.querySelectorAll(".file-chip").forEach((c, i) => {
    c.dataset.idx = i;
    c.querySelector(".file-chip-rm").setAttribute("onclick", `removeFileChip(${i})`);
  });
}

// ══════════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════════
function getArea()        { return document.getElementById("messagesArea"); }
function getPersonality() { return document.getElementById("personality").value; }
function scrollBottom(el) { if(el) el.scrollTop = el.scrollHeight; }
function setHeader(iconHTML, title, sub, actionsHTML) {
  document.getElementById("headerIcon").innerHTML    = iconHTML;
  document.getElementById("headerTitle").textContent = title;
  document.getElementById("headerSub").textContent   = sub;
  document.getElementById("headerActions").innerHTML = actionsHTML||"";
}
function showToast(text) {
  const t=document.createElement("div"); t.className="toast"; t.textContent=text;
  document.body.appendChild(t);
  requestAnimationFrame(()=>t.classList.add("show"));
  setTimeout(()=>{t.classList.remove("show");setTimeout(()=>t.remove(),350);},4000);
}
async function apiFetch(path, method="GET", body=null) {
  const opts={method,headers:{}};
  if(body){opts.headers["Content-Type"]="application/json";opts.body=JSON.stringify(body);}
  const res=await fetch(API_URL+path,opts);
  if(!res.ok) throw new Error("HTTP "+res.status);
  return res.json();
}
