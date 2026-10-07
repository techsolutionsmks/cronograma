/* ====== CONFIGURAÇÃO ====== */
const SHEET_ID = "1bccq5qv1q0rb6X7BkdkxTE0P_oHxil9Ym2y-MP0ydNw";
const SHEET_TAB = "dados";   // opcional: nome da aba (vazio = primeira aba)
const REFRESH_MIN = 5;       // recarrega os dados a cada X minutos

const STAGES = [
  ["publicacao do edital", "Publicação do Edital"],
  ["homologacao", "Homologação"],
  ["ordem de inicio", "Ordem de Início"],
  ["conclusao projeto", "Conclusão do Projeto"],
  ["conclusao da obra", "Conclusão da Obra"]
];
const MESES = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];

/* ====== utilitários ====== */
const $ = id => document.getElementById(id);
const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

function parseCSV(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = ""; rows.push(row); row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(v => v.trim() !== ""));
}

function parseDate(s) {
  s = (s || "").trim();
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

function parseMoney(s) {
  const n = parseFloat((s || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function moneyShort(n) {
  if (n >= 1e9) return "R$ " + (n / 1e9).toFixed(1).replace(".", ",") + " bi";
  if (n >= 1e6) return "R$ " + (n / 1e6).toFixed(1).replace(".", ",") + " mi";
  if (n >= 1e3) return "R$ " + Math.round(n / 1e3) + " mil";
  return "R$ " + Math.round(n);
}

function getStatusClass(statusStr) {
  const n = norm(statusStr);
  if (n.includes("concluid")) return "concluido";
  if (n.includes("andamento")) return "em-andamento";
  if (n.includes("nao executado") || n.includes("não executado")) return "nao-executado";
  return "";
}

function getStatusColor(statusStr) {
  const n = norm(statusStr);
  if (n.includes("concluid")) return "var(--green)";
  if (n.includes("andamento")) return "var(--orange)";
  if (n.includes("nao executado") || n.includes("não executado")) return "var(--red)";
  return "var(--muted)";
}

/* ====== dados ====== */
function buildData(csv) {
  const rows = parseCSV(csv);
  if (!rows.length) return [];
  const head = rows[0].map(norm);
  const idx = name => head.indexOf(name);
  const col = {
    card: idx("card"), 
    mun: idx("municipio"), 
    aprov: idx("valor municipio aprovado"),
    repas: idx("valor repassado"), 
    resolucao: idx("resolucao") !== -1 ? idx("resolucao") : (idx("_resolucao") !== -1 ? idx("_resolucao") : idx("e_resolucao")), 
    emp: idx("empreendimento"), 
    total: idx("valor total"),
    acao: idx("acao"), 
    status: idx("status"), 
    vacao: idx("valor acao")
  };
  const stageIdx = STAGES.map(([k]) => idx(k));
  const get = (r, i) => i >= 0 ? (r[i] || "").trim() : "";
  const groups = new Map();

  rows.slice(1).forEach(r => {
    const mun = get(r, col.mun), num = get(r, col.card);
    if (!mun && !num) return;
    const key = mun + "|" + num;
    if (!groups.has(key)) groups.set(key, { mun, num, emp: "", aprov: "", repas: "", resolucao: "", total: "", lotes: [] });
    const g = groups.get(key);
    ["emp", "aprov", "repas", "resolucao", "total"].forEach(k => { if (!g[k]) g[k] = get(r, col[k]); });
    const stages = stageIdx.map(i => get(r, i));
    const lote = { acao: get(r, col.acao), status: get(r, col.status), valor: get(r, col.vacao), stages };
    if (lote.acao || lote.status || lote.valor || stages.some(Boolean)) g.lotes.push(lote);
  });
  return [...groups.values()];
}

/* ====== cards ====== */
function stageStates(dates) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let nextSet = false;
  return dates.map(raw => {
    if (!raw) return { cls: "none", txt: "—" };
    const d = parseDate(raw);
    const txt = d ? `${MESES[d.getMonth()]}/${String(d.getFullYear()).slice(2)}` : raw;
    if (d && d <= today) return { cls: "done", txt, raw };
    if (!nextSet) { nextSet = true; return { cls: "next", txt, raw }; }
    return { cls: "", txt, raw };
  });
}

const money = (label, v) => v ? `<div><b>${label}:</b> ${esc(v)}</div>` : "";
const info = (label, v) => v ? `<div><b>${label}:</b> ${esc(v)}</div>` : "";

function cardHTML(g) {
  const vals = money("Valor Município Aprovado", g.aprov) + 
               money("Valor Repassado", g.repas) + 
               money("Valor Total", g.total) + 
               info("Resolução", g.resolucao);
               
  const lotes = g.lotes.map(l => {
    const st = stageStates(l.stages);
    const badgeClass = getStatusClass(l.status);
    const badge = l.status ? `<span class="badge ${badgeClass}">${esc(l.status)}</span>` : "";
    return `<section class="lote">
      <div class="lote-head">
        <span class="lote-name">${l.acao ? "Ação " + esc(l.acao) : "Ação"}</span>${badge}
        ${l.valor ? `<span class="lote-val"><b>Valor da ação:</b> ${esc(l.valor)}</span>` : ""}
      </div>
      <div class="stages">${st.map((s, i) => `
        <div class="stage ${s.cls}" ${s.raw ? `title="${esc(s.raw)}"` : ""}>
          <div class="n">${STAGES[i][1]}</div><div class="d">${esc(s.txt)}</div>
        </div>`).join("")}</div>
    </section>`;
  }).join("");

  return `<article class="card">
    <div class="where">${esc(g.mun)} · Card ${esc(g.num)}</div>
    <h2 class="title ${g.emp ? "" : "empty"}">${g.emp ? esc(g.emp) : "Empreendimento a definir"}</h2>
    ${vals ? `<div class="vals">${vals}</div>` : ""}
    ${lotes || `<p class="nolote">Nenhuma ação cadastrada ainda.</p>`}
  </article>`;
}

/* ====== filtros ====== */
let DATA = [];
let MODE = "acoes";
const F = { q: "", mun: "", status: "" };

function fillSelect(el, values, current) {
  el.innerHTML = `<option value="">Todos</option>` +
    values.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
  el.value = values.includes(current) ? current : "";
}

function refreshOptions() {
  const muns = [...new Set(DATA.map(g => g.mun))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  const sts = [...new Set(DATA.flatMap(g => g.lotes.map(l => l.status)).filter(Boolean))].sort();
  fillSelect($("fMun"), muns, F.mun);
  fillSelect($("fStatus"), sts, F.status);
  F.mun = $("fMun").value; F.status = $("fStatus").value;
}

function applyFilters() {
  const q = norm(F.q);
  return DATA.map(g => {
    if (F.mun && g.mun !== F.mun) return null;
    if (q && !norm(g.emp + " " + g.mun).includes(q)) return null;
    let lotes = g.lotes;
    if (F.status) {
      lotes = lotes.filter(l => l.status === F.status);
      if (!lotes.length) return null;
    }
    return { ...g, lotes };
  }).filter(Boolean);
}

/* ====== gráficos ====== */
function chartHTML(list) {
  const byEmp = !!F.mun;
  const map = new Map();
  list.forEach(g => {
    const label = byEmp ? (g.emp || `Card ${g.num}`) : g.mun;
    const key = byEmp ? g.mun + "|" + g.num : g.mun;
    if (!map.has(key)) map.set(key, { label, acoes: 0, valor: 0 });
    const it = map.get(key);
    it.acoes += g.lotes.length;
    it.valor += g.lotes.reduce((s, l) => s + parseMoney(l.valor), 0);
  });
  const items = [...map.values()].filter(i => i[MODE] > 0).sort((a, b) => b[MODE] - a[MODE]);
  if (!items.length) {
    return `<p class="empty-state">${MODE === "acoes" ? "Ainda não há ações cadastradas" : "Ainda não há valores de ações cadastrados"} para este filtro.</p>`;
  }
  const max = items[0][MODE];
  return items.map(i => `
    <div class="bar-row">
      <div class="bar-top"><span title="${esc(i.label)}">${esc(i.label)}</span>
        <span>${MODE === "acoes" ? i.acoes : moneyShort(i.valor)}</span></div>
      <div class="track"><div class="fill" style="width:${Math.max(3, (i[MODE] / max) * 100)}%"></div></div>
    </div>`).join("");
}

function statusChartHTML(list) {
  const statusMap = new Map();
  list.forEach(g => {
    g.lotes.forEach(l => {
      const st = l.status ? l.status : "Sem status definido";
      statusMap.set(st, (statusMap.get(st) || 0) + 1);
    });
  });

  const items = [...statusMap.entries()].map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);

  if (!items.length) {
    return `<p class="empty-state">Sem dados de status para exibir.</p>`;
  }

  const max = items[0].count;
  return items.map(i => {
    const color = getStatusColor(i.status);
    return `
      <div class="bar-row">
        <div class="bar-top"><span title="${esc(i.status)}">${esc(i.status)}</span>
          <span>${i.count}</span></div>
        <div class="track"><div class="fill" style="width:${Math.max(3, (i.count / max) * 100)}%; background: ${color};"></div></div>
      </div>`;
  }).join("");
}

function donutChartHTML(list) {
  const statusMap = new Map();
  let totalCount = 0;
  list.forEach(g => {
    g.lotes.forEach(l => {
      const st = l.status ? l.status : "Sem status definido";
      statusMap.set(st, (statusMap.get(st) || 0) + 1);
      totalCount++;
    });
  });

  if (totalCount === 0) return `<p class="empty-state">Sem dados para o gráfico.</p>`;

  let cumulativePercent = 0;
  const items = [...statusMap.entries()].map(([status, count]) => {
    const percent = (count / totalCount) * 100;
    const color = getStatusColor(status);
    const item = { status, count, percent, color, dashArray: `${percent} ${100 - percent}`, dashOffset: -cumulativePercent };
    cumulativePercent += percent;
    return item;
  });

  const circles = items.map(i => 
    `<circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="${i.color}" stroke-width="4.5" stroke-dasharray="${i.dashArray}" stroke-dashoffset="${i.dashOffset}"></circle>`
  ).join("");

  const legend = items.map(i => `
    <div class="donut-legend-item">
      <span class="donut-dot" style="background: ${i.color}"></span>
      <span><b>${i.status}</b> (${i.count})</span>
    </div>
  `).join("");

  return `
    <div class="donut-container">
      <svg class="donut-svg" viewBox="0 0 42 42">
        <circle cx="21" cy="21" r="15.9155" fill="transparent" stroke="rgba(213,221,231,0.4)" stroke-width="4.5"></circle>
        ${circles}
      </svg>
      <div class="donut-legend">${legend}</div>
    </div>
  `;
}

/* ====== render ====== */
function render() {
  const list = applyFilters();
  const acoes = list.reduce((s, g) => s + g.lotes.length, 0);
  const muns = new Set(list.map(g => g.mun)).size;

  $("cards").innerHTML = list.length
    ? list.map(cardHTML).join("")
    : `<p class="empty-state">Nenhuma obra encontrada. Ajuste ou limpe os filtros.</p>`;

  $("stats").innerHTML =
    `<div class="stat"><b>${list.length}</b><span>Cards</span></div>
     <div class="stat"><b>${acoes}</b><span>Ações</span></div>
     <div class="stat"><b>${muns}</b><span>Municípios</span></div>`;

  $("chartTitle").textContent = F.mun ? `Ações em ${F.mun}` : "Ações por município";
  $("chart").innerHTML = chartHTML(list);
  $("statusChart").innerHTML = statusChartHTML(list);
  $("donutChart").innerHTML = donutChartHTML(list);
}

/* ====== eventos ====== */
$("fQuery").addEventListener("input", e => { F.q = e.target.value; render(); });
$("fMun").addEventListener("change", e => { F.mun = e.target.value; render(); });
$("fStatus").addEventListener("change", e => { F.status = e.target.value; render(); });
$("fClear").addEventListener("click", () => {
  F.q = ""; F.mun = ""; F.status = "";
  $("fQuery").value = ""; $("fMun").value = ""; $("fStatus").value = "";
  render();
});
document.querySelector(".seg").addEventListener("click", e => {
  const b = e.target.closest("button[data-mode]"); if (!b) return;
  MODE = b.dataset.mode;
  document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", x === b));
  render();
});

/* ====== carregar planilha ====== */
async function load() {
  const msg = $("msg");
  try {
    const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1` +
      (SHEET_TAB ? `&sheet=${encodeURIComponent(SHEET_TAB)}` : "");
    const res = await fetch(url);
    if (!res.ok) throw new Error(res.status);
    DATA = buildData(await res.text());
    msg.innerHTML = "";
    $("updated").textContent = "Atualizado às " +
      new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    refreshOptions();
    render();
  } catch (err) {
    msg.innerHTML = `<div class="msg">Não consegui ler a planilha. Confira se ela está com acesso "Qualquer pessoa com o link: Leitor" e se a aba "${esc(SHEET_TAB)}" existe. Tentando de novo em ${REFRESH_MIN} min.</div>`;
  }
}
$("cards").innerHTML = `<p class="empty-state">Carregando…</p>`;
load();
if (REFRESH_MIN > 0) setInterval(load, REFRESH_MIN * 60000);
