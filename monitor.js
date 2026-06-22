const fs = require('fs');
const nodemailer = require('nodemailer');

const EMAIL_DESTINO = process.env.EMAIL_DESTINO;
const EMAIL_REMETENTE = process.env.EMAIL_REMETENTE;
const EMAIL_SENHA = process.env.EMAIL_SENHA;
const ARQUIVO_ESTADO = 'estado.json';
const API_BASE = 'https://sapl.al.rr.leg.br';
const DRY_RUN = process.env.DRY_RUN === '1';

function carregarEstado() {
  if (fs.existsSync(ARQUIVO_ESTADO))
    return JSON.parse(fs.readFileSync(ARQUIVO_ESTADO, 'utf8'));
  return { proposicoes_vistas: [], ultima_execucao: '' };
}

function salvarEstado(estado) {
  fs.writeFileSync(ARQUIVO_ESTADO, JSON.stringify(estado, null, 2));
}

function registrarSaudeFonte(estado, status, detalhe) {
  estado.ultima_execucao = new Date().toISOString();
  estado.ultimo_status = {
    status,
    detalhe,
    registrado_em: estado.ultima_execucao,
  };
  salvarEstado(estado);
  console.log(`Status da fonte: ${status} - ${detalhe}`);
}

function jaAlertouFonteHoje(estado, status) {
  const hoje = new Date().toISOString().slice(0, 10);
  return estado.ultimo_alerta_fonte &&
    estado.ultimo_alerta_fonte.status === status &&
    String(estado.ultimo_alerta_fonte.enviado_em || '').slice(0, 10) === hoje;
}

function escaparHtml(valor) {
  return String(valor || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusHumanoFonte(status) {
  if (status === 'source_blocked') return 'Fonte oficial bloqueada para coleta (HTTP 403)';
  return status;
}

function observacaoFalhaFonte(status, detalhe) {
  if (status === 'source_blocked') {
    return 'A ALE-RR/SAPL está ativa para alguns acessos, mas retorna 403 Forbidden para a coleta automatizada do monitor. Isso indica bloqueio seletivo/configuração de servidor/WAF, não erro de código do monitor. Impacto: enquanto o acesso não for liberado, não conseguimos confirmar proposições novas de RR por esta fonte. Próxima ação: manter alerta operacional e buscar liberação/whitelist ou fonte oficial alternativa.';
  }
  return detalhe;
}

async function enviarAlertaFonte(status, detalhe) {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto">
      <h2 style="color:#8a1f11;border-bottom:2px solid #8a1f11;padding-bottom:8px">
        ⚠️ ALE-RR — monitor sem acesso à fonte oficial
      </h2>
      <p>O monitor de proposições novas de RR executou, mas não conseguiu consultar a fonte oficial.</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:12px">
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Status</td><td style="padding:8px;border:1px solid #ddd">${escaparHtml(statusHumanoFonte(status))}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Por que falhou</td><td style="padding:8px;border:1px solid #ddd">${escaparHtml(observacaoFalhaFonte(status, detalhe))}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold">Fonte</td><td style="padding:8px;border:1px solid #ddd"><a href="${API_BASE}/api/materia/materialegislativa/">${API_BASE}</a></td></tr>
      </table>
      <p style="font-size:12px;color:#777;margin-top:16px">Enquanto a fonte estiver bloqueada, não há como confirmar proposições novas de RR por este monitor.</p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor Roraima" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `⚠️ Roraima: monitor sem acesso à fonte oficial — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log('✅ Alerta operacional de fonte enviado.');
}

function prioridadeTipoEmail(tipo) {
  const t = String(tipo || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (/^(PL|PLO)(\b|$)/.test(t) || /^PROJETO DE LEI( ORDINARIA)?$/.test(t)) return 0;
  if (/^PLC(\b|$)/.test(t) || /^PROJETO DE LEI COMPLEMENTAR/.test(t)) return 1;
  if (/^PEC(\b|$)/.test(t) || /^(PROPOSTA|PROJETO) DE EMENDA (A )?CONSTITUCIONAL/.test(t)) return 2;
  return 10;
}

function compararTiposEmail(a, b) {
  const prioridadeA = prioridadeTipoEmail(a);
  const prioridadeB = prioridadeTipoEmail(b);
  if (prioridadeA !== prioridadeB) return prioridadeA - prioridadeB;
  return String(a || '').localeCompare(String(b || ''), 'pt-BR');
}


const CLIENTES_NOMES_PROPRIOS = [
  'FIRJAN', 'Red Bull', 'Sindicerv', 'Boticario',
  'Boticário', 'Grupo Boticario', 'Grupo Boticário', 'O Boticario',
  'O Boticário', 'Abrasel', 'Abrasel PB', 'Abrasel Paraíba',
  'ANBRASEL', 'Ambev', 'Heineken', 'Abralatas',
  'ABIR', 'Coca-Cola', 'Coca Cola', 'Coca-Cola Company',
  'Femsa', 'Solar', 'Grupo Simões', 'Grupo Simoes',
  'Andina', 'CVI', 'iFood', 'Zé Delivery',
  'Ze Delivery', 'Verde Brasil', 'JCRIG', 'Associação dos Cemitérios e Crematórios do Brasil',
  'Associacao dos Cemiterios e Crematorios do Brasil', 'Lalamove', 'Matrix', 'CVC',
  'Rei do Pitaco', 'Maersk', 'Mac Jee', 'Norte Energia',
  'Pacto Pela Fome', 'Sanofi', 'TikTok', 'Minalba',
  'Esmaltec', 'Nacional Gás', 'Nacional Gas', 'Syngenta',
  'Braskem', 'Ypê', 'Ype', 'VTal',
  'V.tal', 'Grupo EPR', 'EPR', 'Natural Energia',
  'DIAGEO', 'Alpargatas', 'Ternium', 'ABRADEE',
  'Eletrobras', 'Eletrobrás', 'MeetKai', 'IPQ',
  'Equatorial', 'EquatorialEnergia', 'Equatorial Energia', 'Equatorial Goiás',
  'Equatorial Goias', 'Equatorial Goiás Distribuidora de Energia', 'Equatorial Goias Distribuidora de Energia', 'CEA Equatorial',
  'CEA Equatorial Energia', 'Equtorial', 'Energisa', 'EnergisaLuz',
  'Neoenergia', 'ENEL', 'Ampla Energia', 'SABESP',
  'COMGAS', 'COMGÁS', 'AEGEA', 'Aegea Saneamento',
  'Águas de Teresina', 'Aguas de Teresina', 'Águas de Timon', 'Aguas de Timon',
  'Águas do Rio', 'Aguas do Rio', 'Águas do Rio 1', 'Águas do Rio 4',
  'Naturgy', 'Agenersa', 'Regenera', 'Comlurb',
  'Hekos', 'Orizon', 'Solvi', 'União Norte',
  'Uniao Norte', 'Vital', 'Eletromidia', 'Eletromídia',
  'AkzoNobel', 'Expedia', 'Hotels.com', 'Vrbo',
  'RTSC', 'Gramado Parks', 'Grupo Wish', 'Huawei',
  'Carrefour', 'Atacadão', 'Atacadao', 'Walmart',
  "Sam's Club", 'Sams Club', 'JBS', 'Friboi',
  'Seara', 'Swift', "Pilgrim's", 'Pilgrims',
  'Wild Fork', 'Ajinomoto', 'Vibra', 'Vibra Energia',
  'BR Distribuidora', 'Raízen', 'Raizen', 'Mindlab',
  'ABVTEX', 'Semove', 'Barcas', 'Seta',
  'Nova Infra', 'BRT'
];

function clientesCitadosNaProposicao(p) {
  const texto = [p.cliente, p.clientes, p.autor, p.autores, p.tipo, p.rotulo, p.titulo, p.identificacao, p.ementa]
    .filter(Boolean)
    .join(' ');
  const achados = [];
  for (const nome of CLIENTES_NOMES_PROPRIOS) {
    const escaped = nome.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])' + escaped + '([^A-Za-zÀ-ÿ0-9]|$)', 'i');
    if (re.test(texto) && !achados.some(a => a.toLowerCase() === nome.toLowerCase())) achados.push(nome);
  }
  return achados;
}

function anotarClientesCitados(proposicoes) {
  for (const p of proposicoes || []) {
    const clientes = clientesCitadosNaProposicao(p);
    p.clientesCitados = clientes;
    if (clientes.length && p.ementa && !String(p.ementa).includes('Cliente citado:')) {
      p.ementa = String(p.ementa).trim() + ' | Cliente citado: ' + clientes.join(', ');
    }
  }
}

function mlEscapeHtmlClienteDestaque(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function mlEscapeRegExpClienteDestaque(valor) {
  return String(valor).replace(/[.*+?^\${}()|[\]\\]/g, '\\$&');
}

function mlDestacarTermosClienteEmail(texto, clientes) {
  const nomes = Array.from(new Set([...(clientes || []), ...CLIENTES_NOMES_PROPRIOS]))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (!nomes.length) return mlEscapeHtmlClienteDestaque(texto);

  const regex = new RegExp('(^|[^A-Za-zÀ-ÿ0-9])(' + nomes.map(mlEscapeRegExpClienteDestaque).join('|') + ')(?=[^A-Za-zÀ-ÿ0-9]|$)', 'gi');
  return mlEscapeHtmlClienteDestaque(texto).replace(regex, (match, prefixo, termo) => {
    return prefixo + '<span style="background:#dbeafe;color:#1e3a8a;font-weight:700;border-radius:3px;padding:1px 3px">' + termo + '</span>';
  });
}

function renderizarEmentaCliente(p, renderBase) {
  const texto = String((p && p.ementa) || '-');
  const partes = texto.split(/\s+\|\s+Cliente citado:\s+/i);
  const ementa = renderBase
    ? renderBase(partes[0])
    : mlDestacarTermosClienteEmail(partes[0], p && p.clientesCitados);
  const clientes = partes.length > 1
    ? partes.slice(1).join(' | Cliente citado: ')
    : ((p && p.clientesCitados) || []).join(', ');

  if (!clientes) return ementa;
  return ementa + '<div style="margin-top:6px">' +
    '<span style="display:inline-block;background:#eef6ff;border:1px solid #bfdbfe;color:#1e3a8a;border-radius:999px;padding:3px 8px;font-size:11px;font-weight:700">' +
    'Cliente citado: ' + mlDestacarTermosClienteEmail(clientes, p && p.clientesCitados) +
    '</span></div>';
}

async function enviarEmail(novas) {
  anotarClientesCitados(novas);
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL_REMETENTE, pass: EMAIL_SENHA },
  });

  const porTipo = {};
  novas.forEach(p => {
    const tipo = p.tipo || 'OUTROS';
    if (!porTipo[tipo]) porTipo[tipo] = [];
    porTipo[tipo].push(p);
  });

  const linhas = Object.keys(porTipo).sort(compararTiposEmail).map(tipo => {
    const header = `<tr><td colspan="5" style="padding:10px 8px 4px;background:#f0f4f8;font-weight:bold;color:#1a3a5c;font-size:13px;border-top:2px solid #1a3a5c">${tipo} — ${porTipo[tipo].length} proposição(ões)</td></tr>`;
    const rows = porTipo[tipo].map(p =>
      `<tr>
        <td style="padding:8px;border-bottom:1px solid #eee;color:#555;font-size:12px">${escaparHtml(p.tipo || '-')}</td>
        <td style="padding:8px;border-bottom:1px solid #eee"><strong><a href="${escaparHtml(p.url)}">${escaparHtml(p.numero || '-')}/${escaparHtml(p.ano || '-')}</a></strong></td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${escaparHtml(p.autor || '-')}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px;white-space:nowrap">${escaparHtml(p.data || '-')}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-size:12px">${renderizarEmentaCliente(p)}</td>
      </tr>`
    ).join('');
    return header + rows;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:900px;margin:0 auto">
      <h2 style="color:#1a3a5c;border-bottom:2px solid #1a3a5c;padding-bottom:8px">
        🏛️ Assembleia Legislativa de Roraima — ${novas.length} nova(s) proposição(ões)
      </h2>
      <p style="color:#666">Monitoramento automático — ${new Date().toLocaleString('pt-BR')}</p>
      <table style="width:100%;border-collapse:collapse;font-size:14px">
        <thead>
          <tr style="background:#1a3a5c;color:white">
            <th style="padding:10px;text-align:left">Tipo</th>
            <th style="padding:10px;text-align:left">Número/Ano</th>
            <th style="padding:10px;text-align:left">Autor</th>
            <th style="padding:10px;text-align:left">Data</th>
            <th style="padding:10px;text-align:left">Ementa</th>
          </tr>
        </thead>
        <tbody>${linhas}</tbody>
      </table>
      <p style="margin-top:20px;font-size:12px;color:#999">
        Acesse: <a href="https://sapl.al.rr.leg.br/materia/pesquisar-materia">sapl.al.rr.leg.br</a>
      </p>
    </div>
  `;

  await transporter.sendMail({
    from: `"Monitor Roraima" <${EMAIL_REMETENTE}>`,
    to: EMAIL_DESTINO,
    subject: `🏛️ Roraima: ${novas.length} nova(s) proposição(ões) — ${new Date().toLocaleDateString('pt-BR')}`,
    html,
  });

  console.log(`✅ Email enviado com ${novas.length} proposições novas.`);
}

async function buscarProposicoes() {
  const ano = new Date().getFullYear();
  const pageSize = 100;
  const maxPaginas = 200;
  const todas = [];
  console.log(`🔍 Buscando proposições de ${ano} na ALE-RR...`);

  for (let pagina = 1; pagina <= maxPaginas; pagina++) {
    const url = `${API_BASE}/api/materia/materialegislativa/?ano=${ano}&page=${pagina}&page_size=${pageSize}&ordering=-id`;
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      }
    });

    if (!response.ok) {
      const erro = new Error(`Erro na API: ${response.status} ${response.statusText}`);
      erro.status = response.status;
      erro.url = url;
      throw erro;
    }

    const json = await response.json();
    const lista = json.results || [];
    const pagination = json.pagination || {};
    const totalPaginas = pagination.total_pages || (json.count ? Math.ceil(json.count / pageSize) : null);
    console.log(`📄 Página ${pagina}/${totalPaginas || '?'}: ${lista.length} proposições`);

    if (lista.length === 0) break;
    todas.push(...lista);

    const temProxima = Boolean(json.next || pagination.links?.next || pagination.next_page);
    if (totalPaginas ? pagina >= totalPaginas : !temProxima && lista.length < pageSize) break;
  }

  console.log(`📊 ${todas.length} proposições recebidas`);
  return todas;
}

function extrairTipo(p) {
  if (p.__str__) {
    const match = p.__str__.match(/^(.+?)\s+n[oº°]/i);
    if (match) return match[1].trim().toUpperCase();
  }
  return p.tipo ? String(p.tipo) : 'OUTROS';
}

function normalizarProposicao(p) {
  return {
    id: String(p.id),
    tipo: extrairTipo(p),
    numero: p.numero || '-',
    ano: p.ano || '-',
    autor: Array.isArray(p.autores) && p.autores.length > 0
      ? p.autores.map(a => a.nome || a).join(', ')
      : '-',
    data: p.data_apresentacao || '-',
    ementa: (p.ementa || '-'),
    url: `${API_BASE}/materia/${p.id}`,
  };
}

(async () => {
  console.log('🚀 Iniciando monitor ALE-RR...');
  console.log(`⏰ ${new Date().toLocaleString('pt-BR')}`);

  const estado = carregarEstado();
  const idsVistos = new Set(estado.proposicoes_vistas.map(String));

  let raw;
  try {
    raw = await buscarProposicoes();
  } catch (err) {
    if (err.status === 403) {
      const detalhe = 'ALE-RR/SAPL retornou 403 Forbidden para a API publica; sem alerta novo ate a fonte voltar.';
      if (DRY_RUN) {
        console.log(`🧪 Dry-run ativo: alerta de fonte não enviado e estado não alterado. ${detalhe}`);
        process.exit(0);
      }
      if (!jaAlertouFonteHoje(estado, 'source_blocked')) {
        await enviarAlertaFonte('source_blocked', detalhe);
        estado.ultimo_alerta_fonte = {
          status: 'source_blocked',
          detalhe,
          enviado_em: new Date().toISOString(),
        };
      }
      registrarSaudeFonte(
        estado,
        'source_blocked',
        detalhe
      );
      process.exit(0);
    }
    registrarSaudeFonte(
      estado,
      'source_error',
      err.message || 'Erro desconhecido ao consultar ALE-RR/SAPL'
    );
    process.exit(1);
  }

  if (raw.length === 0) {
    console.log('⚠️ Nenhuma proposição encontrada.');
    process.exit(0);
  }

  const proposicoes = raw.map(normalizarProposicao).filter(p => p.id);
  console.log(`📊 Total normalizado: ${proposicoes.length}`);

  const novas = proposicoes.filter(p => !idsVistos.has(p.id));
  console.log(`🆕 Proposições novas: ${novas.length}`);

  if (novas.length > 0 && DRY_RUN) {
    const amostra = novas.slice(0, 5).map(p => `${p.tipo} ${p.numero}/${p.ano} -> ${p.url}`).join('\n');
    console.log(`🧪 Dry-run ativo: email não enviado e estado não alterado. Amostra com links:\n${amostra}`);
  } else if (novas.length > 0) {
    novas.sort((a, b) => {
      if (a.tipo < b.tipo) return -1;
      if (a.tipo > b.tipo) return 1;
      return (parseInt(b.numero) || 0) - (parseInt(a.numero) || 0);
    });
    await enviarEmail(novas);
    novas.forEach(p => idsVistos.add(p.id));
    estado.proposicoes_vistas = Array.from(idsVistos);
  } else {
    console.log('✅ Sem novidades. Nada a enviar.');
  }

  estado.ultima_execucao = new Date().toISOString();
  salvarEstado(estado);
})();
