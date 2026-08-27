/* ====================================================
   elevolt · Painel de Rastreamento de Frota
   ----------------------------------------------------
   Versão 1: dados simulados (mock) para você ver o
   painel funcionando no navegador. Quando o servidor
   Traccar estiver no ar, trocamos a seção de dados
   por chamadas à API dele (dica no final do arquivo).
   ==================================================== */

/* ---------- 1. DADOS DA FROTA (mock) ----------
   Cada veículo tem:
   - rotaProgramada: lista de pontos [latitude, longitude]
   - status: 'em_rota' | 'parado' | 'alerta'
   Troque as placas e ajuste as rotas para a sua realidade. */

const VEICULOS = [
  {
    id: 1,
    nome: 'Saveiro',
    tipo: 'Pickup',
    placa: 'PLACA-0001', // TODO: trocar pela placa real
    status: 'em_rota',
    cor: '#00aee5',
    icone: '🛻',
    rotaProgramada: [
      [-23.6261, -46.6566], // região de Congonhas
      [-23.6330, -46.6480],
      [-23.6450, -46.6340],
      [-23.6620, -46.6180],
      [-23.6800, -46.6050],
      [-23.7000, -46.6000],
    ],
  },
  {
    id: 2,
    nome: 'Uno',
    tipo: 'Hatch',
    placa: 'PLACA-0002', // TODO: trocar pela placa real
    status: 'parado',
    cor: '#295a9a',
    icone: '🚗',
    rotaProgramada: [
      [-23.5571, -46.6630], // Av. Paulista
      [-23.5540, -46.6560],
      [-23.5600, -46.6480],
      [-23.5680, -46.6420],
    ],
  },
  {
    id: 3,
    nome: 'Corolla',
    tipo: 'Sedan',
    placa: 'PLACA-0003', // TODO: trocar pela placa real
    status: 'em_rota',
    cor: '#10b981',
    icone: '🚙',
    rotaProgramada: [
      [-23.5620, -46.6970], // região da Faria Lima
      [-23.5680, -46.6900],
      [-23.5800, -46.6800],
      [-23.5950, -46.6700],
      [-23.6100, -46.6600],
    ],
  },
  {
    id: 4,
    nome: 'Caminhão',
    tipo: 'Pesado',
    placa: 'PLACA-0004', // TODO: trocar pela placa real
    status: 'em_rota',
    cor: '#16345c',
    icone: '🚚',
    rotaProgramada: [
      [-23.5200, -46.7000], // Marginal Tietê
      [-23.5080, -46.7400],
      [-23.4950, -46.7900],
      [-23.4800, -46.8400],
      [-23.4600, -46.8900], // sentido Rodovia Anhanguera
    ],
  },
];

/* ---------- 2. ESTADO DA APLICAÇÃO ---------- */

const INFO_STATUS = {
  em_rota: { label: 'Em rota', cor: '#10b981' },
  parado: { label: 'Parado', cor: '#f59e0b' },
  alerta: { label: 'Alerta', cor: '#e11d48' },
};

let mapa;
let buscaTermo = '';
let veiculoSelecionado = null;
let simulando = false;
let intervalo = null;
let mostrarRotas = true;

const marcadores = {};      // id -> marcador no mapa
const linhaPercorrida = {}; // id -> linha azul (trajeto feito)
const linhaProgramada = {}; // id -> linha tracejada (rota prevista)
const progresso = {};       // id -> 0 a 1 (avanço na rota)
const ultimaAtualizacao = {}; // id -> Date

/* ---------- 3. FUNÇÕES DO MAPA ---------- */

function configurarMapa() {
  mapa = L.map('mapa');

  // Camada de mapa gratuita do OpenStreetMap
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(mapa);

  ajustarMapa();
}

function ajustarMapa() {
  if (veiculoSelecionado) {
    const v = VEICULOS.find((x) => x.id === veiculoSelecionado);
    const pos = posicaoAtual(v);
    mapa.setView(pos, 13);
    return;
  }

  // Mostra toda a frota de uma vez
  const pontos = VEICULOS.map((v) => posicaoAtual(v));
  mapa.fitBounds(pontos, { padding: [60, 60] });
}

function criarIcone(v) {
  return L.divIcon({
    className: 'veiculo-marcador',
    html: `<div class="pino ${v.status}" style="--cor-veiculo:${v.cor}"></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function posicaoAtual(v) {
  return calcularPosicaoNaRota(v.rotaProgramada, progresso[v.id]);
}

function criarMarcador(v) {
  const m = L.marker(posicaoAtual(v), { icon: criarIcone(v) }).addTo(mapa);
  m.bindPopup(popupHTML(v));
  m.on('click', () => selecionarVeiculo(v.id));
  marcadores[v.id] = m;
}

function atualizarMarcador(v) {
  marcadores[v.id].setLatLng(posicaoAtual(v));
  marcadores[v.id].setIcon(criarIcone(v));
  marcadores[v.id].setPopupContent(popupHTML(v));
}

function popupHTML(v) {
  const st = INFO_STATUS[v.status];
  return `
    <div class="popup-veiculo">
      <strong>${v.icone} ${v.nome}</strong>
      <span class="popup-status" style="--status-cor:${st.cor}">${st.label}</span>
      <small>${v.tipo} · ${v.placa}</small>
    </div>`;
}

/* ---------- 4. LINHAS DE ROTA ---------- */

function desenharLinhaProgramada(v) {
  if (linhaProgramada[v.id]) {
    mapa.removeLayer(linhaProgramada[v.id]);
  }
  linhaProgramada[v.id] = L.polyline(v.rotaProgramada, {
    color: '#00aee5',
    weight: 3,
    dashArray: '8 8',
    opacity: 0.75,
  }).addTo(mapa);
}

function desenharLinhaPercorrida(v) {
  if (linhaPercorrida[v.id]) {
    mapa.removeLayer(linhaPercorrida[v.id]);
  }
  const pontos = pontosPercorridos(v.rotaProgramada, progresso[v.id]);
  linhaPercorrida[v.id] = L.polyline(pontos, {
    color: v.cor,
    weight: 4,
    opacity: 0.9,
  }).addTo(mapa);
}

function alternarVisibilidadeRotas() {
  mostrarRotas = !mostrarRotas;
  VEICULOS.forEach((v) => {
    linhaProgramada[v.id].setStyle({ opacity: mostrarRotas ? 0.75 : 0 });
  });
  document.getElementById('btnAlternarRota').textContent =
    mostrarRotas ? '👁 Rota programada' : '🙈 Esconder rota';
}

/* ---------- 5. MATEMÁTICA DE POSIÇÃO ---------- */

function calcularPosicaoNaRota(rota, p) {
  const n = rota.length - 1;
  const seg = Math.min(Math.max(p, 0), 1) * n;
  const i = Math.min(Math.floor(seg), n - 1);
  const t = seg - i;
  const [la1, lo1] = rota[i];
  const [la2, lo2] = rota[i + 1];
  return [la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t];
}

function pontosPercorridos(rota, p) {
  const n = rota.length - 1;
  const seg = Math.min(Math.max(p, 0), 1) * n;
  const i = Math.min(Math.floor(seg), n - 1);
  const t = seg - i;
  const pontos = rota.slice(0, i + 1);
  if (t > 0 && i < n) {
    const [la1, lo1] = rota[i];
    const [la2, lo2] = rota[i + 1];
    pontos.push([la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t]);
  }
  return pontos;
}

/* ---------- 6. SIDEBAR E LISTA ---------- */

function renderizarLista() {
  const lista = document.getElementById('listaVeiculos');
  const termo = buscaTermo.toLowerCase();

  const filtrados = VEICULOS.filter((v) => {
    return (
      v.nome.toLowerCase().includes(termo) ||
      v.tipo.toLowerCase().includes(termo) ||
      v.placa.toLowerCase().includes(termo)
    );
  });

  if (filtrados.length === 0) {
    lista.innerHTML = '<li class="sem-resultado">Nenhum veículo encontrado</li>';
    return;
  }

  lista.innerHTML = filtrados.map((v) => cardHTML(v)).join('');
}

function cardHTML(v) {
  const st = INFO_STATUS[v.status];
  const selecionado = veiculoSelecionado === v.id ? ' selecionado' : '';
  const tempo = tempoDesde(ultimaAtualizacao[v.id]);

  return `
    <li class="card-veiculo${selecionado}" data-id="${v.id}" style="--cor-veiculo:${v.cor}">
      <div class="card-avatar">${v.icone}</div>
      <div class="card-info">
        <div class="card-nome">${v.nome}</div>
        <div class="card-status ${v.status}" style="--status-cor:${st.cor}">${st.label}</div>
        <div class="card-meta">${v.tipo} · ${v.placa}</div>
      </div>
      <div class="card-tempo">${tempo}</div>
    </li>`;
}

function atualizarContadores() {
  const total = VEICULOS.length;
  const emRota = VEICULOS.filter((v) => v.status === 'em_rota').length;
  const parados = total - emRota;
  document.getElementById('contadores').innerHTML = `
    <span class="chip">${total} veículos</span>
    <span class="chip verde">${emRota} em rota</span>
    ${parados > 0 ? `<span class="chip laranja">${parados} parado(s)</span>` : ''}`;
}

function tempoDesde(data) {
  const s = Math.floor((Date.now() - data.getTime()) / 1000);
  if (s < 5) return 'agora';
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `há ${m}min`;
  return `há ${Math.floor(m / 60)}h`;
}

/* ---------- 7. SELEÇÃO E PAINEL DE DETALHES ---------- */

function selecionarVeiculo(id) {
  veiculoSelecionado = id;
  const v = VEICULOS.find((x) => x.id === id);

  renderizarLista();
  ajustarMapa();
  abrirPainel(v);
}

function abrirPainel(v) {
  const st = INFO_STATUS[v.status];
  const pos = posicaoAtual(v);
  document.getElementById('painelDetalhe').classList.remove('oculto');
  document.getElementById('detalheNome').textContent = `${v.icone} ${v.nome}`;
  document.getElementById('detalheTipo').textContent = v.tipo;
  document.getElementById('detalhePlaca').textContent = v.placa;
  document.getElementById('detalheStatus').textContent = st.label;
  document.getElementById('detalheStatus').style.color = st.cor;
  document.getElementById('detalhePosicao').textContent =
    `${pos[0].toFixed(4)}, ${pos[1].toFixed(4)}`;
  document.getElementById('detalheAtualizado').textContent = tempoDesde(ultimaAtualizacao[v.id]);
}

function atualizarPainelSelecionado() {
  if (!veiculoSelecionado) return;
  const v = VEICULOS.find((x) => x.id === veiculoSelecionado);
  abrirPainel(v);
}

/* ---------- 8. SIMULAÇÃO DE MOVIMENTO ----------
   Finge que os veículos se movem pela rota programada.
   Útil para você ver o painel "vivo" antes do Traccar. */

function alternarSimulacao() {
  simulando = !simulando;
  const btn = document.getElementById('btnSimular');

  if (simulando) {
    // Reinicia veículos que já chegaram ao destino
    VEICULOS.forEach((v) => {
      if (v.status === 'parado' && progresso[v.id] >= 1) {
        v.status = 'em_rota';
        progresso[v.id] = 0;
      }
    });
    renderizarLista();
    atualizarContadores();

    btn.textContent = '⏸ Pausar simulação';
    btn.classList.add('ativo');
    intervalo = setInterval(moverVeiculos, 2000);
  } else {
    btn.textContent = '▶ Iniciar simulação';
    btn.classList.remove('ativo');
    clearInterval(intervalo);
  }
}

function moverVeiculos() {
  VEICULOS.forEach((v) => {
    if (v.status !== 'em_rota') return;

    progresso[v.id] += 0.03;
    ultimaAtualizacao[v.id] = new Date();

    if (progresso[v.id] >= 1) {
      progresso[v.id] = 1;
      v.status = 'parado'; // chegou ao destino
    }

    atualizarMarcador(v);
    desenharLinhaPercorrida(v);
  });

  renderizarLista();
  atualizarContadores();
  atualizarPainelSelecionado();
}

/* ---------- 9. RELÓGIO E EVENTOS ---------- */

function atualizarRelogio() {
  const agora = new Date();
  document.getElementById('relogio').textContent = agora.toLocaleTimeString('pt-BR');
  document.getElementById('data').textContent = agora.toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: 'short',
  });
}

function atualizarTempos() {
  document.querySelectorAll('.card-tempo').forEach((el) => {
    const id = Number(el.closest('.card-veiculo').dataset.id);
    el.textContent = tempoDesde(ultimaAtualizacao[id]);
  });
  atualizarPainelSelecionado();
}

function conectarEventos() {
  document.getElementById('listaVeiculos').addEventListener('click', (e) => {
    const card = e.target.closest('.card-veiculo');
    if (card) selecionarVeiculo(Number(card.dataset.id));
  });

  document.getElementById('busca').addEventListener('input', (e) => {
    buscaTermo = e.target.value;
    renderizarLista();
  });

  document.getElementById('btnSimular').addEventListener('click', alternarSimulacao);
  document.getElementById('btnCentralizar').addEventListener('click', ajustarMapa);
  document.getElementById('btnAlternarRota').addEventListener('click', alternarVisibilidadeRotas);
  document.getElementById('fecharPainel').addEventListener('click', () => {
    document.getElementById('painelDetalhe').classList.add('oculto');
  });

  document.getElementById('btnMenu').addEventListener('click', () => {
    document.body.classList.add('sidebar-aberta');
  });
  document.getElementById('overlay').addEventListener('click', () => {
    document.body.classList.remove('sidebar-aberta');
  });
}

/* ---------- 10. INICIALIZAÇÃO ---------- */

document.addEventListener('DOMContentLoaded', () => {
  configurarMapa();

  VEICULOS.forEach((v) => {
    progresso[v.id] = v.status === 'parado' ? 0 : 0.05 + Math.random() * 0.2;
    ultimaAtualizacao[v.id] = new Date();
    criarMarcador(v);
    desenharLinhaProgramada(v);
    desenharLinhaPercorrida(v);
  });

  renderizarLista();
  atualizarContadores();
  atualizarRelogio();
  conectarEventos();

  setInterval(atualizarRelogio, 1000);
  setInterval(atualizarTempos, 1000);
});

/* ====================================================
   PRÓXIMA ETAPA: CONECTAR O TRACCAR
   ----------------------------------------------------
   Quando o Traccar estiver rodando, substitua os dados
   mock por chamadas reais, por exemplo:

   fetch('https://SEU_SERVIDOR/api/positions', {
     headers: { 'Authorization': 'Basic ' + btoa('usuario:senha') }
   })
   .then(r => r.json())
   .then(posicoes => { // atualiza marcadores com lat/lon reais
     console.log(posicoes);
   });

   Cada posição do Traccar tem: id, deviceId, latitude,
   longitude, speed, course, fixTime. A rota percorrida
   vem do endpoint /api/positions?deviceId=X.
   ==================================================== */
   