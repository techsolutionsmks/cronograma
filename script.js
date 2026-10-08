/* ====== CONFIGURAÇÃO ====== */
const SHEET_ID = "1bccq5qv1q0rb6X7BkdkxTE0P_oHxil9Ym2y-MP0ydNw";
const SHEET_TAB = "dados";   // opcional: nome da aba (vazio = primeira aba)
const REFRESH_MIN = 5;       // recarrega os dados a cada X minutos
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbyPIGjniYYeDDh7iz_FA73TvcY6oEkeomONoo2el0jeq4sKsr-Hvg3JNrQ9ocHMdZBCOQ/exec";

const STAGES = [
  ["publicacao do edital", "Publicação do Edital"],
  ["homologacao", "Homologação"],
  ["ordem de inicio", "Ordem de Início"],
  ["conclusao projeto", "Conclusão do Projeto"],
  ["conclusao da obra", "Conclusão da Obra"]
];
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

/* ====== utilitários ====== */
const $ = id => document.getElementById(id);
const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

function formatDateDisplay(raw) {
  if (!raw) return "—";
  const d = parseDate(raw);
  if (d) {
    const dia = String(d.getDate()).padStart(2, '0');
    const mes = String(d.getMonth() + 1).padStart(2, '0');
    const ano = d.getFullYear();
    return `${dia}/${mes}/${ano}`;
  }
  return raw;
}

function parseMoney(s) {
  const n = parseFloat((s || "").replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
}

function formatCurrency(val) {
  if (typeof val === "number") {
    return val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }
  const num = parseMoney(val);
  return num ? num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }) : (val ? val : "R$ 0,00");
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

/* ====== cards (Com suporte a edição e exclusão inline completa) ====== */
let EDIT_MODE = false;
let SENHA_ADMIN_VALIDA = "";

function stageStates(dates) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let nextSet = false;
  return dates.map(raw => {
    if (!raw) return { cls: "none", txt: "—" };
    const d = parseDate(raw);
    const txt = formatDateDisplay(raw);
    if (d && d <= today) return { cls: "done", txt, raw };
    if (!nextSet) { nextSet = true; return { cls: "next", txt, raw }; }
    return { cls: "", txt, raw };
  });
}

const info = (label, v) => v ? `<div><b>${label}:</b> ${esc(v)}</div>` : "";

function cardHTML(g) {
  const vals = info("Resolução nº", g.resolucao);
  
  const lotes = g.lotes.map(l => {
    const st = stageStates(l.stages);
    const badgeClass = getStatusClass(l.status);
    const badge = l.status ? `<span class="badge ${badgeClass}">${esc(l.status)}</span>` : "";

    if (EDIT_MODE) {
      return `<section class="lote edit-lote" data-card="${esc(g.num)}" data-mun="${esc(g.mun)}" data-acao-antiga="${esc(l.acao)}" style="background: rgba(29, 95, 209, 0.04); padding: 14px; border-radius: 8px; margin-top: 12px; border: 1.5px dashed var(--blue);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
          <span style="font-weight:700; font-size:0.85rem; color:var(--blue);">✏️ Editando Card / Ação:</span>
          <button type="button" class="btn-excluir-lote" style="background:var(--red); color:#fff; border:none; padding:4px 10px; border-radius:4px; font-size:0.75rem; cursor:pointer; font-weight:600;">Excluir Linha</button>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:0.82rem; margin-bottom:10px;">
          <label style="grid-column: span 2;"><span>Município:</span> <input type="text" class="in-mun" value="${esc(g.mun)}" style="width:100%; padding:5px; border:1px solid #ccc; border-radius:4px;"></label>
          <label style="grid-column: span 2;"><span>Empreendimento:</span> <input type="text" class="in-emp" value="${esc(g.emp)}" style="width:100%; padding:5px; border:1px solid #ccc; border-radius:4px;"></label>
          <label><span>Resolução:</span> <input type="text" class="in-resolucao" value="${esc(g.resolucao)}" style="width:100%; padding:5px; border:1px solid #ccc; border-radius:4px;"></label>
          <label><span>Status:</span> <input type="text" class="in-status" value="${esc(l.status)}" style="width:100%; padding:5px; border:1px solid #ccc; border-radius:4px;"></label>
          <label><span>Nome da Ação:</span> <input type="text" class="in-acao" value="${esc(l.acao)}" style="width:100%; padding:5px; border:1px solid #ccc; border-radius:4px;"></label>
          <label><span>Valor da Ação:</span> <input type="text" class="in-valor" value="${esc(l.valor)}" style="width:100%; padding:5px; border:1px solid #ccc; border-radius:4px;"></label>
          
          <div style="grid-column: span 2; border-top:1px solid rgba(0,0,0,0.1); margin-top:4px; padding-top:6px; font-weight:600; color:var(--ink);">Datas das Etapas (DD/MM/AAAA):</div>
          ${STAGES.map(([key, label], sIdx) => `
            <label><span>${label}:</span> <input type="text" class="in-stage" data-stage-index="${sIdx}" value="${esc(l.stages[sIdx] || '')}" placeholder="DD/MM/YYYY" style="width:100%; padding:4px; border:1px solid #ccc; border-radius:4px;"></label>
          `).join("")}
        </div>
        <button type="button" class="btn-salvar-lote" style="background:var(--green); color:#fff; border:none; padding:6px 12px; border-radius:4px; font-weight:600; font-size:0.8rem; cursor:pointer; width:100%; margin-top:6px;">Salvar Alterações </button>
      </section>`;
    }

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

  return `<article class="card" style="${EDIT_MODE ? 'border: 2px solid var(--blue); box-shadow: 0 4px 20px rgba(29,95,209,0.15);' : ''}">
    <div class="where">${esc(g.mun)}</div>
    ${vals ? `<div class="vals">${vals}</div>` : ""} 
    <h2 class="title ${g.emp ? "" : "empty"}">${g.emp ? esc(g.emp) : "Empreendimento a definir"}</h2> 
    ${lotes || `<p class="nolote">Nenhuma ação cadastrada ainda.</p>`}
  </article>`;
}

/* ====== filtros ====== */
let DATA = [];
const F = { q: "", mun: "", status: "", chartMun: "" };

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
  
  if ($("chartMunFilter")) {
    fillSelect($("chartMunFilter"), muns, F.chartMun);
  }
  
  F.mun = $("fMun").value; 
  F.status = $("fStatus").value;
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

/* ====== gráficos e valores municípios ====== */
function valuesChartHTML(baseList) {
  const map = new Map();
  let sourceData = DATA;
  if (F.mun) {
    sourceData = DATA.filter(g => g.mun === F.mun);
  }

  sourceData.forEach(g => {
    if (!g.mun) return;
    if (!map.has(g.mun)) {
      map.set(g.mun, {
        mun: g.mun,
        aprov: parseMoney(g.aprov),
        repas: parseMoney(g.repas)
      });
    }
  });

  let items = [...map.values()];
  
  if (F.chartMun) {
    items = items.filter(i => i.mun === F.chartMun);
  }

  items.sort((a, b) => a.mun.localeCompare(b.mun, "pt-BR"));

  if (!items.length) {
    return `<p class="empty-state" style="font-size:0.85rem; padding:10px 0;">Nenhum município encontrado.</p>`;
  }

  return items.map(i => `
    <div style="background: rgba(213,221,231,0.15); padding:10px 12px; border-radius:8px; margin-bottom:8px; border:1px solid var(--line);">
      <div style="font-weight:700; color:var(--ink); font-size:0.88rem; margin-bottom:6px;">${esc(i.mun)}</div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--muted); margin-bottom:3px;">
        <span>Total Aprovado:</span>
        <span style="font-weight:600; color:var(--ink);">${formatCurrency(i.aprov)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--muted);">
        <span>Valor Repassado:</span>
        <span style="font-weight:600; color:var(--green);">${formatCurrency(i.repas)}</span>
      </div>
    </div>
  `).join("");
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

  if ($("chart")) {
    const parentContainer = $("chart").parentElement;
    if (!document.getElementById("chartMunFilter")) {
      const filterWrapper = document.createElement("div");
      filterWrapper.style.cssText = "margin-bottom: 12px; display: flex; flex-direction: column; gap: 4px;";
      filterWrapper.innerHTML = `
        <label style="font-size:0.75rem; font-weight:600; color:var(--muted);">Filtrar Município:</label>
        <select id="chartMunFilter" style="width:100%; height:32px; padding:0 8px; border:1px solid var(--line-solid); border-radius:6px; font-size:0.8rem; background:#fff;"></select>
      `;
      parentContainer.insertBefore(filterWrapper, $("chart"));
      
      const munsList = [...new Set(DATA.map(g => g.mun))].sort((a, b) => a.localeCompare(b, "pt-BR"));
      fillSelect($("chartMunFilter"), munsList, F.chartMun);

      $("chartMunFilter").addEventListener("change", e => {
        F.chartMun = e.target.value;
        render();
      });
    }
  }

  $("chartTitle").textContent = "Valores Municípios";
  $("chart").innerHTML = valuesChartHTML(list);
  $("statusChart").innerHTML = statusChartHTML(list);
  $("donutChart").innerHTML = donutChartHTML(list);
}

/* ====== eventos ====== */
$("fQuery").addEventListener("input", e => { F.q = e.target.value; render(); });
$("fMun").addEventListener("change", e => { 
  F.mun = e.target.value; 
  render(); 
});
$("fStatus").addEventListener("change", e => { F.status = e.target.value; render(); });
$("fClear").addEventListener("click", () => {
  F.q = ""; F.mun = ""; F.status = ""; F.chartMun = "";
  $("fQuery").value = ""; $("fMun").value = ""; $("fStatus").value = "";
  if ($("chartMunFilter")) $("chartMunFilter").value = "";
  render();
});

const segElement = document.querySelector(".seg");
if (segElement) {
  segElement.style.display = "none";
}

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
    msg.innerHTML = `<div class="msg">Dados não carregados.</div>`;
  }
}
$("cards").innerHTML = `<p class="empty-state">Carregando…</p>`;
load();
if (REFRESH_MIN > 0) setInterval(load, REFRESH_MIN * 60000);


/* ====== MODAL DE SENHA E EDIÇÃO/EXCLUSÃO DIRETO NOS CARDS + LOADING ====== */

document.body.insertAdjacentHTML('beforeend', `
<div id="loadingOverlay" style="display:none; position:fixed; inset:0; background:rgba(15,42,67,0.4); z-index:10000; align-items:center; justify-content:center; backdrop-filter:blur(4px);">
  <div style="background:#fff; padding:20px 30px; border-radius:12px; box-shadow:0 10px 30px rgba(0,0,0,0.2); font-weight:600; color:var(--ink); display:flex; align-items:center; gap:12px; font-size:0.95rem;">
    <span style="font-size:1.2rem; animation: spin 1s linear infinite;">⏳</span> Processando alteração...
  </div>
</div>

<div id="passwordModal" style="display:none; position:fixed; inset:0; background:rgba(15,42,67,0.6); z-index:9999; align-items:center; justify-content:center; backdrop-filter:blur(6px);">
  <div style="background:#fff; width:90%; max-width:400px; padding:24px; border-radius:16px; box-shadow:0 12px 40px rgba(0,0,0,0.25);">
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
      <h3 style="margin:0; color:var(--ink); font-size:1.1rem;">🔒 Acesso Administrativo</h3>
      <button type="button" id="btnClosePasswordModal" style="background:transparent; border:none; font-size:1.2rem; cursor:pointer; color:var(--muted);">✕</button>
    </div>
    <p style="font-size:0.85rem; color:var(--muted); margin-bottom:14px;">Digite a senha mestra para liberar a edição direta nos cards:</p>
    <input type="password" id="inputAdminPassword" placeholder="••••••••••••" style="width:100%; height:40px; padding:0 12px; border:1.5px solid var(--line-solid); border-radius:8px; margin-bottom:14px; font-size:1rem;">
    <button type="button" id="btnConfirmPassword" class="clear" style="background:var(--blue); color:#fff; width:100%; height:40px; border:none; font-weight:600; border-radius:8px; cursor:pointer;">Desbloquear Edição</button>
  </div>
</div>
`);

document.getElementById("btnAdmin").addEventListener("click", () => {
  if (!EDIT_MODE) {
    $("passwordModal").style.display = "flex";
    $("inputAdminPassword").value = "";
    $("inputAdminPassword").focus();
  } else {
    EDIT_MODE = false;
    SENHA_ADMIN_VALIDA = "";
    document.getElementById("btnAdmin").textContent = "⚙️ Gerenciar Sistema";
    document.getElementById("btnAdmin").style.background = "var(--blue)";
    render();
  }
});

$("btnClosePasswordModal").addEventListener("click", () => {
  $("passwordModal").style.display = "none";
});

$("btnConfirmPassword").addEventListener("click", async () => {
  const senha = $("inputAdminPassword").value;
  if (!senha.trim()) {
    alert("Digite a senha!");
    return;
  }

  try {
    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action: "validar_senha", senha: senha })
    });
    const result = await res.json();

    if (result.status === "sucesso") {
      SENHA_ADMIN_VALIDA = senha;
      EDIT_MODE = true;
      $("passwordModal").style.display = "none";
      document.getElementById("btnAdmin").textContent = "🔒 Sair da Edição";
      document.getElementById("btnAdmin").style.background = "var(--orange)";
      render();
    } else {
      alert("Senha incorreta!");
      $("inputAdminPassword").value = "";
      $("inputAdminPassword").focus();
    }
  } catch (err) {
    alert("Erro ao validar senha: " + err);
  }
});

async function enviarParaAppsScript(payload) {
  const loadingEl = $("loadingOverlay");
  try {
    if (loadingEl) loadingEl.style.display = "flex"; // Mostra o carregando
    payload.senha = SENHA_ADMIN_VALIDA;

    const res = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    const result = await res.json();
    if (result.status === "sucesso") {
      alert("Sucesso: Alteração realizada! ");
      await load(); // Recarrega os dados atualizados
    } else {
      alert("Aviso / Erro: " + result.message);
    }
  } catch (err) {
    alert("Erro de comunicação com o Apps Script: " + err);
  } finally {
    if (loadingEl) loadingEl.style.display = "none"; // Oculta o carregando ao finalizar
  }
}

document.getElementById("cards").addEventListener("click", e => {
  if (e.target.classList.contains("btn-salvar-lote")) {
    const container = e.target.closest(".edit-lote");
    
    const stagesData = {};
    container.querySelectorAll(".in-stage").forEach(input => {
      const idx = input.dataset.stageIndex;
      stagesData[`stage_${idx}`] = input.value;
    });

    enviarParaAppsScript({
      action: "editar",
      card: container.dataset.card,
      municipio_antigo: container.dataset.mun,
      acao_antiga: container.dataset.acaoAntiga,
      municipio: container.querySelector(".in-mun").value,
      empreendimento: container.querySelector(".in-emp").value,
      resolucao: container.querySelector(".in-resolucao").value,
      acao: container.querySelector(".in-acao").value,
      status: container.querySelector(".in-status").value,
      valor_acao: container.querySelector(".in-valor").value,
      stages: stagesData
    });
  }

  if (e.target.classList.contains("btn-excluir-lote")) {
    if (confirm("Tem certeza que deseja excluir esta ação permanentemente?")) {
      const container = e.target.closest(".edit-lote");
      enviarParaAppsScript({
        action: "excluir",
        card: container.dataset.card,
        municipio: container.dataset.mun,
        acao: container.dataset.acaoAntiga
      });
    }
  }
});
