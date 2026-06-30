// =============================================
//  CONFIGURAÇÃO DA API
// =============================================
const API = 'http://localhost:8080';

// =============================================
//  ESTADO GLOBAL
// =============================================
let currentUser        = null;   // { id, username, role }
let loginTab           = 'cliente';
let cadastroTab        = 'cliente';
let canaisSelecionados = new Set();

// =============================================
//  HELPERS HTTP
// =============================================
async function http(method, path, body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include'
  };
  if (body !== null) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(msg || `Erro ${res.status}`);
  }
  const text = await res.text();
  if (!text) return null;
  // Tenta JSON; se não for JSON válido (ex: "Cliente Salvo"), retorna o texto puro
  try { return JSON.parse(text); } catch { return text; }
}

const get   = path         => http('GET',    path);
const post  = (path, body) => http('POST',   path, body);
const put   = (path, body) => http('PUT',    path, body);
const patch = (path, body) => http('PATCH',  path, body);
const del   = path         => http('DELETE', path);

// =============================================
//  LOGIN / LOGOUT / CADASTRO
// =============================================
function setLoginTab(tab) {
  loginTab = tab;
  document.querySelectorAll('#page-login .login-tab').forEach((b, i) =>
    b.classList.toggle('active', (i===0&&tab==='cliente')||(i===1&&tab==='manager')));
}

function setCadastroTab(tab) {
  cadastroTab = tab;
  document.querySelectorAll('#page-cadastro .login-tab').forEach((b, i) =>
    b.classList.toggle('active', (i===0&&tab==='cliente')||(i===1&&tab==='manager')));
  document.getElementById('cad-cpf-group').style.display = tab === 'manager' ? 'block' : 'none';
}

async function doLogin() {
  const username = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value.trim();
  const errEl    = document.getElementById('login-error');
  errEl.style.display = 'none';

  if (!username || !password) { showError(errEl, 'Preencha todos os campos'); return; }

  try {
    if (loginTab === 'manager') {
      // GET /managerLogin → valida localmente
      const lista = await get('/managerLogin');
      const user  = lista.find(u => u.managerUsername === username && u.managerPassword === password);
      if (!user) { showError(errEl, 'Usuário ou senha inválidos'); return; }
      currentUser = { id: user.managerID, username: user.managerUsername, role: 'manager' };
    } else {
      // GET /cliente → valida localmente
      const lista = await get('/cliente');
      const user  = lista.find(u => u.clienteUsername === username && u.clientePassword === password);
      if (!user) { showError(errEl, 'Usuário ou senha inválidos'); return; }
      currentUser = { id: user.clienteID, username: user.clienteUsername, role: 'cliente' };
    }

    document.getElementById('nav-user').textContent =
      username + (loginTab === 'manager' ? ' · Manager' : ' · Cliente');
    document.getElementById('btn-logout').style.display  = 'block';
    document.getElementById('tab-manager').style.display =
      loginTab === 'manager' ? 'block' : 'none';

    showPage(loginTab === 'manager' ? 'manager' : 'cardapio');
    showToast('Bem-vindo, ' + username + '!');
  } catch (e) {
    showError(errEl, 'Erro ao conectar com a API. Verifique se o backend está rodando.');
  }
}

async function doCadastro() {
  const username = document.getElementById('cad-user').value.trim();
  const password = document.getElementById('cad-pass').value.trim();
  const errEl    = document.getElementById('cad-error');
  errEl.style.display = 'none';

  if (!username || !password) { showError(errEl, 'Preencha todos os campos'); return; }
  if (password.length < 6)    { showError(errEl, 'Senha mínimo 6 caracteres'); return; }

  try {
    if (cadastroTab === 'cliente') {
      // POST /cliente/addCliente
      await post('/cliente/addCliente', {
        clienteUsername:   username,
        clientePassword:   password,
        emailCliente:      '',
        telefoneCliente:   '',
        redeSocialCliente: ''
      });
    } else {
      const cpfRaw = document.getElementById('cad-cpf').value.trim();
      if (cpfRaw.length !== 11 || isNaN(Number(cpfRaw))) {
        showError(errEl, 'CPF deve ter exatamente 11 dígitos numéricos'); return;
      }
      // POST /managerLogin/addManager
      await post('/managerLogin/addManager', {
        managerUsername: username,
        managerPassword: password,
        managerCPF:      parseInt(cpfRaw, 10)
      });
    }
    showToast('Conta criada! Faça login.');
    showPage('login');
  } catch (e) {
    showError(errEl, e.message || 'Erro ao cadastrar');
  }
}

function doLogout() {
  currentUser = null;
  document.getElementById('nav-user').textContent      = '—';
  document.getElementById('btn-logout').style.display  = 'none';
  document.getElementById('tab-manager').style.display = 'none';
  document.getElementById('badge-pedidos').textContent = '0';
  document.getElementById('login-user').value          = '';
  document.getElementById('login-pass').value          = '';
  showPage('login');
  showToast('Até logo!');
}

// =============================================
//  NAVEGAÇÃO
// =============================================
function showPage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');

  const map  = { login:'0', cadastro:'0', cardapio:'1', pedidos:'2', manager:'3' };
  const tabs = document.querySelectorAll('.nav-tab');
  if (map[id] !== undefined) tabs[Number(map[id])]?.classList.add('active');

  if (id === 'cardapio') loadCardapio();
  if (id === 'pedidos')  loadPedidos();
  if (id === 'manager')  { loadManagerPratos(); loadManagerPedidos(); }
}

// =============================================
//  CARDÁPIO
//  GET /prato → { pratoID, pratoNome, pratoValor, pratoSaindo }
//  pratoSaindo: true = Saindo (disponível) | false = Encerrado
// =============================================
function pratoDisponivel(p) {
  return p.pratoSaindo !== false;
}

async function loadCardapio() {
  const grid    = document.getElementById('cardapio-grid');
  const loading = document.getElementById('cardapio-loading');
  grid.innerHTML = '';
  loading.style.display = 'block';

  try {
    const pratos = await get('/prato');
    loading.style.display = 'none';

    if (!pratos || !pratos.length) {
      grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--text-light)">Nenhum prato disponível no momento.</div>';
      return;
    }

    grid.innerHTML = pratos.map(p => {
      const disponivel = pratoDisponivel(p);
      const statusTxt  = disponivel ? 'Saindo' : 'Encerrado';
      const statusCls  = disponivel ? 'status-pronto' : 'status-finalizado';
      return `
        <div class="prato-card">
          <div class="prato-card-img">🍽️</div>
          <div class="prato-card-body">
            <div class="prato-card-nome">${p.pratoNome}</div>
            <span class="prato-card-status ${statusCls}">${statusTxt}</span>
            <div class="prato-card-footer">
              <div class="prato-card-valor">R$ ${Number(p.pratoValor).toFixed(2).replace('.', ',')}</div>
              <button class="btn-pedir"
                onclick="fazerPedido(${p.pratoID},'${p.pratoNome.replace(/'/g,"\\'")}',${p.pratoValor})"
                ${!disponivel ? 'disabled' : ''}>
                ${!disponivel ? 'Encerrado' : 'Pedir'}
              </button>
            </div>
          </div>
        </div>`;
    }).join('');

  } catch(e) {
    loading.style.display = 'none';
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:#f38ba8">
      Não foi possível carregar o cardápio.<br>
      <small>Verifique se a API está rodando em ${API}</small></div>`;
  }
}

// =============================================
//  PEDIDOS — agora persistidos no backend
//  POST   /pedido/addPedido          → cria pedido
//  GET    /pedido/cliente/{id}        → pedidos do cliente logado
//  GET    /pedido                     → todos (manager)
//  PATCH  /pedido/{id}/cancelar       → cliente cancela
//  PATCH  /pedido/{id}/status         → manager atualiza status
// =============================================
async function fazerPedido(pratoId, pratoNome, pratoValor) {
  if (!currentUser) { showToast('Faça login para realizar pedidos'); showPage('login'); return; }
  if (currentUser.role === 'manager') { showToast('Managers não realizam pedidos'); return; }

  try {
    await post('/pedido/addPedido', {
      clienteID: currentUser.id,
      pratoID:   pratoId,
      quantidade: 1
    });
    showToast('Pedido de ' + pratoNome + ' realizado!');

    // Atualiza o badge com o total de pedidos do cliente
    const pedidos = await get('/pedido/cliente/' + currentUser.id);
    const ativos  = pedidos.filter(p => p.pedidoStatus !== 'CANCELADO' && p.pedidoStatus !== 'ENTREGUE');
    document.getElementById('badge-pedidos').textContent = ativos.length;
  } catch(e) {
    showToast('Erro ao realizar pedido: ' + e.message);
  }
}

async function loadPedidos() {
  const el = document.getElementById('pedidos-list');

  if (!currentUser) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🔒</div>
      <div class="empty-state-text">Faça login para ver seus pedidos</div></div>`;
    return;
  }

  el.innerHTML = '<div style="text-align:center;padding:2rem;color:var(--text-light)">Carregando...</div>';

  try {
    // Manager vê todos; cliente vê só os seus
    const endpoint = currentUser.role === 'manager'
      ? '/pedido'
      : '/pedido/cliente/' + currentUser.id;

    const pedidos = await get(endpoint);
    const ativos  = pedidos.filter(p => p.pedidoStatus !== 'CANCELADO' && p.pedidoStatus !== 'ENTREGUE');
    document.getElementById('badge-pedidos').textContent = ativos.length;

    if (!pedidos.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🍽️</div>
        <div class="empty-state-text">Nenhum pedido ainda</div>
        <div style="font-size:0.75rem;letter-spacing:0.1em;text-transform:uppercase">Explore nosso cardápio</div></div>`;
      return;
    }

    const statusCls = s => s === 'PENDENTE'   ? 'status-preparando'
                         : s === 'CANCELADO'  ? 'status-finalizado'
                         : 'status-pronto';
    const statusTxt = s => ({ PENDENTE:'Pendente', EM_PREPARO:'Em Preparo',
                               ENTREGUE:'Entregue', CANCELADO:'Cancelado' }[s] || s);

    el.innerHTML = pedidos.map(p => {
      // O backend retorna o objeto aninhado: p.prato.pratoNome, p.prato.pratoValor
      const nome  = p.prato?.pratoNome  || 'Prato #' + p.prato?.pratoID;
      const data  = p.dataPedido ? new Date(p.dataPedido).toLocaleString('pt-BR') : '';
      const total = Number(p.valorTotal).toFixed(2).replace('.', ',');
      const podeCancelar = p.pedidoStatus !== 'CANCELADO' && p.pedidoStatus !== 'ENTREGUE';
      return `
        <div class="pedido-item">
          <span style="font-size:1.8rem">🍽️</span>
          <div class="pedido-info">
            <div class="pedido-nome">${nome}</div>
            <div class="pedido-meta">
              ${data} · Qtd: ${p.quantidade} ·
              <span class="prato-card-status ${statusCls(p.pedidoStatus)}"
                    style="font-size:0.55rem;padding:0.15rem 0.4rem">
                ${statusTxt(p.pedidoStatus)}
              </span>
            </div>
          </div>
          <div class="pedido-valor">R$ ${total}</div>
          ${podeCancelar
            ? `<button class="btn-delete" onclick="cancelarPedido(${p.pedidoID})" title="Cancelar">✕</button>`
            : ''}
        </div>`;
    }).join('');

  } catch(e) {
    el.innerHTML = `<div style="text-align:center;padding:2rem;color:#f38ba8">Erro ao carregar pedidos: ${e.message}</div>`;
  }
}

async function cancelarPedido(id) {
  try {
    await patch('/pedido/' + id + '/cancelar', {});
    showToast('Pedido cancelado');
    loadPedidos();
  } catch(e) {
    showToast('Erro: ' + e.message);
  }
}

// =============================================
//  MANAGER — PRATOS
//  GET    /prato              → lista
//  POST   /prato/addPrato     → { pratoNome, pratoValor, pratoSaindo }
//  PUT    /prato/{id}         → { pratoNome, pratoValor, pratoSaindo }
//  DELETE /prato/{id}
// =============================================
async function loadManagerPratos() {
  const el      = document.getElementById('manager-prato-list');
  const loading = document.getElementById('manager-loading');
  loading.style.display = 'block';
  el.innerHTML  = '';

  try {
    const pratos = await get('/prato');
    loading.style.display = 'none';

    if (!pratos || !pratos.length) {
      el.innerHTML = '<div style="color:var(--text-light);font-size:0.8rem;text-align:center;padding:1rem">Nenhum prato cadastrado</div>';
      return;
    }

    el.innerHTML = pratos.map(p => {
      const saindo = p.pratoSaindo !== false;
      return `
        <div class="manager-prato-item">
          <span>🍽️</span>
          <div class="manager-prato-nome">${p.pratoNome}</div>
          <div class="manager-prato-valor">R$ ${Number(p.pratoValor).toFixed(2).replace('.', ',')}</div>
          <select class="btn-status ${saindo ? 'pronto' : 'finalizado'}"
                  onchange="atualizarSaindo(${p.pratoID}, this.value === 'true', '${p.pratoNome.replace(/'/g,"\\'")}', ${p.pratoValor})">
            <option value="true"  ${saindo  ? 'selected' : ''}>Saindo</option>
            <option value="false" ${!saindo ? 'selected' : ''}>Encerrado</option>
          </select>
          <button class="btn-delete" onclick="deletarPrato(${p.pratoID})">✕</button>
        </div>`;
    }).join('');

  } catch(e) {
    loading.style.display = 'none';
    el.innerHTML = `<div style="color:#f38ba8;font-size:0.8rem;padding:1rem">Erro: ${e.message}</div>`;
  }
}

async function adicionarPrato() {
  const nome   = document.getElementById('m-nome').value.trim();
  const valor  = parseFloat(document.getElementById('m-valor').value);
  const status = document.getElementById('m-status').value;

  if (!nome || isNaN(valor) || valor <= 0) { showToast('Preencha nome e valor'); return; }

  // pratoSaindo: true = disponível; false = encerrado
  const pratoSaindo = status !== 'FINALIZADO';

  try {
    await post('/prato/addPrato', { pratoNome: nome, pratoValor: valor, pratoSaindo });
    document.getElementById('m-nome').value  = '';
    document.getElementById('m-valor').value = '';
    showToast('Prato adicionado!');
    loadManagerPratos();
    loadCardapio();
  } catch(e) {
    showToast('Erro: ' + e.message);
  }
}

async function atualizarSaindo(id, pratoSaindo, pratoNome, pratoValor) {
  try {
    // PUT /prato/{id} — único endpoint de atualização disponível no backend
    await put('/prato/' + id, { pratoNome, pratoValor, pratoSaindo });
    showToast('Status atualizado!');
    loadManagerPratos();
    loadCardapio();
  } catch(e) {
    showToast('Erro: ' + e.message);
  }
}

async function deletarPrato(id) {
  try {
    await del('/prato/' + id);
    showToast('Prato removido');
    loadManagerPratos();
    loadCardapio();
  } catch(e) {
    showToast('Erro: ' + e.message);
  }
}

// =============================================
//  MANAGER — PEDIDOS EM ABERTO
//  GET   /pedido                      → todos os pedidos
//  PATCH /pedido/{id}/status          → { "status": "EM_PREPARO" }
// =============================================
async function loadManagerPedidos() {
  const el = document.getElementById('manager-pedidos-list');
  el.innerHTML = '<div style="color:var(--text-light);font-size:0.8rem;text-align:center;padding:1rem">Carregando...</div>';

  try {
    const todos   = await get('/pedido');
    const abertos = todos.filter(p =>
      p.pedidoStatus === 'PENDENTE' || p.pedidoStatus === 'EM_PREPARO');

    if (!abertos.length) {
      el.innerHTML = '<div style="color:var(--text-light);font-size:0.8rem;text-align:center;padding:1rem">Nenhum pedido em aberto</div>';
      return;
    }

    const statusCls = s => s === 'PENDENTE' ? 'preparando' : s === 'EM_PREPARO' ? 'pronto' : 'finalizado';

    el.innerHTML = abertos.map(p => {
      const nome = p.prato?.pratoNome || 'Prato #' + p.prato?.pratoID;
      const data = p.dataPedido ? new Date(p.dataPedido).toLocaleString('pt-BR') : '';
      return `
        <div class="manager-prato-item">
          <span>🧾</span>
          <div class="manager-prato-nome" style="font-size:0.9rem">
            ${nome}<br>
            <small style="color:var(--text-light)">
              Cliente #${p.cliente?.clienteID} · Qtd: ${p.quantidade} · ${data}
            </small>
          </div>
          <div class="manager-prato-valor">R$ ${Number(p.valorTotal).toFixed(2).replace('.', ',')}</div>
          <select class="btn-status ${statusCls(p.pedidoStatus)}"
                  onchange="atualizarStatusPedido(${p.pedidoID}, this.value)">
            <option value="PENDENTE"   ${p.pedidoStatus==='PENDENTE'  ?'selected':''}>Pendente</option>
            <option value="EM_PREPARO" ${p.pedidoStatus==='EM_PREPARO'?'selected':''}>Em Preparo</option>
            <option value="ENTREGUE"   ${p.pedidoStatus==='ENTREGUE'  ?'selected':''}>Entregue</option>
            <option value="CANCELADO"  ${p.pedidoStatus==='CANCELADO' ?'selected':''}>Cancelado</option>
          </select>
        </div>`;
    }).join('');

  } catch(e) {
    el.innerHTML = `<div style="color:#f38ba8;font-size:0.8rem;padding:1rem">Erro: ${e.message}</div>`;
  }
}

async function atualizarStatusPedido(id, status) {
  try {
    await patch('/pedido/' + id + '/status', { status });
    showToast('Status do pedido atualizado!');
    loadManagerPedidos();
  } catch(e) {
    showToast('Erro: ' + e.message);
  }
}

// =============================================
//  DIVULGAÇÃO  (sem endpoint no backend — UI apenas)
// =============================================
function toggleCanal(canal) {
  const btn = document.getElementById('canal-' + canal);
  if (canaisSelecionados.has(canal)) {
    canaisSelecionados.delete(canal);
    btn.classList.remove('selected');
  } else {
    canaisSelecionados.add(canal);
    btn.classList.add('selected');
  }
}

function enviarDivulgacao() {
  if (!currentUser) { showToast('Faça login como Manager'); return; }
  const msg  = document.getElementById('div-msg').value.trim();
  const dest = document.getElementById('div-dest').value.trim();
  if (!canaisSelecionados.size) { showToast('Selecione ao menos um canal'); return; }
  if (!msg) { showToast('Digite uma mensagem'); return; }

  showToast('Divulgação enviada via ' + Array.from(canaisSelecionados).join(', ') + '!');
  document.getElementById('div-msg').value  = '';
  document.getElementById('div-dest').value = '';
  canaisSelecionados.clear();
  document.querySelectorAll('.canal-btn').forEach(b => b.classList.remove('selected'));
}

// =============================================
//  UTILITÁRIOS
// =============================================
function showError(el, msg) {
  el.textContent   = msg;
  el.style.display = 'block';
}

function showToast(msg) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const t = document.createElement('div');
  t.className   = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Carrega o cardápio ao abrir a página
loadCardapio();
