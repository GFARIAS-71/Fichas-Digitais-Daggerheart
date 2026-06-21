/* =====================================================================
   Ficha de Personagem Digital — script.js
   Front-end puro: autenticação, lista de personagens e ficha interativa.
   Comunicação com o backend via fetch + rotas REST. Token JWT em sessionStorage.

   Versão reconciliada com o index.html e o style.css atuais:
   - seletores e classes ajustados para baterem com o HTML/CSS existentes
   - toast criado dinamicamente (não existe elemento no HTML)
====================================================================== */

(() => {
  'use strict';

  // -------------------------------------------------------------------
  // Estado e helpers de API
  // -------------------------------------------------------------------
  const API = ''; // mesma origem do servidor

  let token = sessionStorage.getItem('token') || null;
  let usuario = JSON.parse(sessionStorage.getItem('usuario') || 'null');

  let personagemId = null;   // id do personagem aberto
  let ficha = null;          // objeto completo da ficha em edição
  let timerSalvar = null;    // debounce
  let souSomenteMestre = false; // true quando o mestre abre ficha de um jogador

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

  function guardarSessao(t, u) {
    token = t; usuario = u;
    sessionStorage.setItem('token', t);
    sessionStorage.setItem('usuario', JSON.stringify(u));
  }
  function limparSessao() {
    token = null; usuario = null;
    sessionStorage.removeItem('token');
    sessionStorage.removeItem('usuario');
  }

  async function api(rota, opcoes = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opcoes.headers || {}) };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const resp = await fetch(API + rota, { ...opcoes, headers });
    let corpo = null;
    try { corpo = await resp.json(); } catch (_) { /* sem corpo */ }
    if (!resp.ok) {
      if (resp.status === 401) { limparSessao(); mostrarAuth(); }
      throw new Error((corpo && corpo.erro) || 'Erro na requisição (' + resp.status + ').');
    }
    return corpo;
  }

  // -------------------------------------------------------------------
  // Toast — criado dinamicamente (não existe no HTML).
  // -------------------------------------------------------------------
  function obterToast() {
    let t = $('#toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'toast';
      Object.assign(t.style, {
        position: 'fixed',
        left: '50%',
        bottom: '28px',
        transform: 'translateX(-50%)',
        background: '#1a1a1a',
        color: '#ededed',
        border: '1px solid #3a3a3d',
        borderRadius: '9px',
        padding: '11px 18px',
        fontSize: '14px',
        fontFamily: "'Inter', system-ui, sans-serif",
        boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
        zIndex: '100',
        maxWidth: '90vw',
        textAlign: 'center',
      });
      t.hidden = true;
      document.body.appendChild(t);
    }
    return t;
  }
  function toast(msg, erro = false) {
    const t = obterToast();
    t.textContent = msg;
    t.style.borderColor = erro ? '#e5484d' : '#3a3a3d';
    t.style.color = erro ? '#e5484d' : '#ededed';
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.hidden = true), 2600);
  }

  // -------------------------------------------------------------------
  // Troca de telas
  // -------------------------------------------------------------------
  function mostrarTela(id) {
    ['tela-auth', 'tela-lista', 'tela-ficha'].forEach((t) => ($('#' + t).hidden = t !== id));
    window.scrollTo(0, 0);
  }
  function mostrarAuth() { mostrarTela('tela-auth'); }

  // ===================================================================
  // AUTENTICAÇÃO
  // ===================================================================
  let modoAuth = 'login';
  let papelEscolhido = 'jogador';

  function configurarAuth() {
    $$('.aba-auth').forEach((b) =>
      b.addEventListener('click', () => {
        modoAuth = b.dataset.modo;
        $$('.aba-auth').forEach((x) => x.classList.toggle('ativa', x === b));
        $('#bloco-papel').hidden = modoAuth !== 'registro';
        $('#btn-auth').textContent = modoAuth === 'login' ? 'Entrar' : 'Criar Conta';
        $('#aviso-auth').hidden = true;
        $('#aviso-auth').textContent = '';
      })
    );

    $$('.papel-btn').forEach((b) =>
      b.addEventListener('click', () => {
        papelEscolhido = b.dataset.papel;
        $$('.papel-btn').forEach((x) => x.classList.toggle('ativa', x === b));
      })
    );

    $('#form-auth').addEventListener('submit', async (e) => {
      e.preventDefault();
      const nome_usuario = $('#auth-usuario').value.trim();
      const senha = $('#auth-senha').value;
      const aviso = $('#aviso-auth');
      aviso.hidden = true;
      aviso.textContent = '';
      if (!nome_usuario || !senha) return;

      try {
        const rota = modoAuth === 'login' ? '/api/login' : '/api/registro';
        const corpo =
          modoAuth === 'login'
            ? { nome_usuario, senha }
            : { nome_usuario, senha, papel: papelEscolhido };
        const r = await api(rota, { method: 'POST', body: JSON.stringify(corpo) });
        guardarSessao(r.token, r.usuario);
        iniciarApp();
      } catch (err) {
        aviso.textContent = err.message;
        aviso.hidden = false;
      }
    });
  }

  // ===================================================================
  // LISTA DE PERSONAGENS
  // ===================================================================
  async function carregarLista() {
    const ehMestre = usuario.papel === 'mestre';
    $('#lista-titulo').textContent = ehMestre ? 'Personagens dos meus jogadores' : 'Meus personagens';
    $('#lista-saudacao').textContent =
      'Conectado como ' + usuario.nome_usuario + ' · ' + (ehMestre ? 'Mestre' : 'Jogador');
    // Mestre não cria personagens
    $('#acoes-jogador').hidden = ehMestre;

    const grade = $('#grade-personagens');
    grade.innerHTML = '';
    let lista = [];
    try {
      const resp = await api('/api/personagens');
      lista = Array.isArray(resp) ? resp : (resp.personagens || []);
    } catch (err) {
      toast(err.message, true);
      return;
    }

    const vazio = $('#vazio-lista');
    vazio.hidden = lista.length > 0;
    if (!lista.length) {
      vazio.textContent = ehMestre
        ? 'Nenhum jogador vinculou você como mestre ainda. Compartilhe seu nome de usuário.'
        : 'Você ainda não tem personagens. Crie o primeiro!';
    }

    lista.forEach((p) => {
      const cartao = document.createElement('div');
      cartao.className = 'cartao-personagem';

      const avatar = document.createElement('div');
      avatar.className = 'cartao-avatar';
      if (p.imagem) {
        avatar.style.backgroundImage = `url("${p.imagem}")`;
      } else {
        avatar.textContent = '🎲';
      }

      const info = document.createElement('div');
      info.className = 'cartao-info';
      const metaMestre = ehMestre
        ? 'Jogador: ' + (p.dono || '—')
        : 'Mestre: ' + (p.nome_mestre || 'não vinculado');
      info.innerHTML = `
        <h3>${escapar(p.nome || 'Sem nome')}</h3>
        <div class="classe">${escapar(p.classe || 'Sem classe')}</div>
        <div class="dono">${escapar(metaMestre)}</div>
      `;

      cartao.appendChild(avatar);
      cartao.appendChild(info);
      cartao.addEventListener('click', () => abrirFicha(p.id));

      if (!ehMestre) {
        const btnDel = document.createElement('button');
        btnDel.className = 'cartao-excluir';
        btnDel.title = 'Excluir personagem';
        btnDel.textContent = '✕';
        btnDel.addEventListener('click', async (ev) => {
          ev.stopPropagation();
          if (!confirm(`Excluir "${p.nome}"? Esta ação não pode ser desfeita.`)) return;
          try {
            await api('/api/personagens/' + p.id, { method: 'DELETE' });
            toast('Personagem excluído.');
            carregarLista();
          } catch (err) { toast(err.message, true); }
        });
        cartao.appendChild(btnDel);
      }
      grade.appendChild(cartao);
    });
  }

  function configurarLista() {
    $('#btn-sair').addEventListener('click', async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch (_) {}
      limparSessao();
      mostrarAuth();
    });

    $('#btn-novo-personagem').addEventListener('click', async () => {
      const nome = prompt('Nome do novo personagem:', 'Novo Personagem');
      if (nome === null) return;
      const nome_mestre = prompt('Nome de usuário do seu mestre (opcional — deixe em branco para vincular depois):', '');
      try {
        const dadosNovos = fichaPadrao();
        dadosNovos.nome = nome.trim() || 'Novo Personagem';
        const novo = await api('/api/personagens', {
          method: 'POST',
          body: JSON.stringify({
            dados: dadosNovos,
            nome_mestre: nome_mestre ? nome_mestre.trim() : null,
          }),
        });
        toast('Personagem criado.');
        abrirFicha(novo.id);
      } catch (err) { toast(err.message, true); }
    });
  }

  // ===================================================================
  // FICHA — modelo padrão
  // ===================================================================
  function fichaPadrao() {
    const medidor = (total) => ({ total, estados: Array(total).fill(false) });
    return {
      imagem: null,
      nome: '', classe: '', dominios: '', ancestralidade: '', comunidade: '',
      atributos: { forca: 0, agilidade: 0, acuidade: 0, instinto: 0, conhecimento: 0, presenca: 0 },
      evasao: 0, evasaoBase: 0,
      limiares: { menor: 0, maior: 0 },
      recursos: {
        armadura: medidor(6),
        vida: medidor(6),
        fadiga: medidor(6),
        esperanca: medidor(6),
      },
      experiencias: Array.from({ length: 5 }, () => ({ nome: '', bonus: 0 })),
      ouro: { punhados: 0, bolsas: 0, baus: 0 },
      habilidades: [
        { titulo: 'Nova habilidade', ativa: false, custo: '1 Esperança', descricao: '' },
      ],
      armas: {
        proficiencia: Array(6).fill(false),
        principal: { nome: '', atributo: 'Força', alcance: 'Corpo a Corpo', dados: '', habNome: '', habDesc: '' },
        secundaria: { nome: '', atributo: 'Força', alcance: 'Corpo a Corpo', dados: '', habNome: '', habDesc: '' },
      },
      armadura: { nome: '', limiaresBase: '', pontosBase: 0, habNome: '', habDesc: '' },
      inventario: [],
      anotacoes: [],
    };
  }

  // garante que fichas antigas tenham todos os campos
  function normalizar(f) {
    const base = fichaPadrao();
    const merge = (alvo, padrao) => {
      for (const k in padrao) {
        if (alvo[k] === undefined || alvo[k] === null) alvo[k] = JSON.parse(JSON.stringify(padrao[k]));
        else if (typeof padrao[k] === 'object' && !Array.isArray(padrao[k])) merge(alvo[k], padrao[k]);
      }
      return alvo;
    };
    return merge(f && typeof f === 'object' ? f : {}, base);
  }

  // ===================================================================
  // FICHA — abrir / salvar
  // ===================================================================
  async function abrirFicha(id) {
    try {
      const p = await api('/api/personagens/' + id);
      personagemId = id;
      ficha = normalizar(p.dados);
      souSomenteMestre = !p.sou_dono && p.sou_mestre;
      renderFicha();
      mostrarTela('tela-ficha');
    } catch (err) { toast(err.message, true); }
  }

  function agendarSalvar() {
    const estado = $('#status-salvo');
    estado.textContent = 'Salvando…';
    estado.className = 'status-salvo salvando';
    clearTimeout(timerSalvar);
    timerSalvar = setTimeout(salvarAgora, 600);
  }

  async function salvarAgora() {
    if (!personagemId) return;
    const estado = $('#status-salvo');
    try {
      await api('/api/personagens/' + personagemId, {
        method: 'PUT',
        body: JSON.stringify({ dados: ficha }),
      });
      estado.textContent = 'Tudo salvo';
      estado.className = 'status-salvo salvo';
    } catch (err) {
      estado.textContent = 'Erro ao salvar';
      estado.className = 'status-salvo';
      toast(err.message, true);
    }
  }

  function configurarFicha() {
    $('#btn-voltar').addEventListener('click', async () => {
      clearTimeout(timerSalvar);
      await salvarAgora();
      personagemId = null; ficha = null;
      carregarLista();
      mostrarTela('tela-lista');
    });

    // Abas do painel direito
    $$('.aba').forEach((b) =>
      b.addEventListener('click', () => {
        const alvo = b.dataset.aba;
        $$('.aba').forEach((x) => x.classList.toggle('ativa', x === b));
        $$('.conteudo-aba').forEach((c) => (c.hidden = c.dataset.conteudo !== alvo));
      })
    );

    // Input de imagem (existente no HTML) — handler único.
    $('#input-imagem').addEventListener('change', (e) => {
      const arq = e.target.files && e.target.files[0];
      if (!arq || !ficha) return;
      const leitor = new FileReader();
      leitor.onload = () => { ficha.imagem = leitor.result; renderGeral(); agendarSalvar(); };
      leitor.readAsDataURL(arq);
      e.target.value = '';
    });
  }

  // ===================================================================
  // FICHA — render
  // ===================================================================
  function renderFicha() {
    const estado = $('#status-salvo');
    estado.textContent = '';
    estado.className = 'status-salvo';
    renderGeral();
    renderHabilidades();
    renderEquipamentos();
    renderAnotacoes();
  }

  // ----- PAINEL ESQUERDO: GERAL --------------------------------------
  function renderGeral() {
    const c = $('#painel-geral');
    c.innerHTML = '';

    // Imagem (reaproveita o #input-imagem do HTML)
    const avatar = document.createElement('div');
    avatar.className = 'area-imagem';
    avatar.title = 'Clique para trocar a imagem';
    if (ficha.imagem) {
      avatar.style.backgroundImage = `url("${ficha.imagem}")`;
    } else {
      avatar.innerHTML = iconeCamera();
    }
    avatar.addEventListener('click', () => $('#input-imagem').click());
    c.appendChild(avatar);

    // Campos de texto empilhados
    [
      ['Nome', 'nome'],
      ['Classe', 'classe'],
      ['Domínios', 'dominios'],
      ['Ancestralidade', 'ancestralidade'],
      ['Comunidade', 'comunidade'],
    ].forEach(([rotulo, chave]) => {
      c.appendChild(campoTexto(rotulo, ficha[chave], (v) => { ficha[chave] = v; agendarSalvar(); }));
    });

    // ATRIBUTOS
    c.appendChild(secao('Atributos', (corpo) => {
      const grade = document.createElement('div');
      grade.className = 'grade-atributos';
      [
        ['Força', 'forca'], ['Agilidade', 'agilidade'], ['Acuidade', 'acuidade'],
        ['Instinto', 'instinto'], ['Conhecimento', 'conhecimento'], ['Presença', 'presenca'],
      ].forEach(([rotulo, chave]) => grade.appendChild(cartaoAtributo(rotulo, chave)));
      corpo.appendChild(grade);
    }));

    // RECURSOS
    c.appendChild(secao('Recursos', (corpo) => {
      // Evasão
      const linha = document.createElement('div');
      linha.className = 'linha-evasao';

      const cxEvasao = document.createElement('div');
      cxEvasao.className = 'evasao-box';
      const inpEv = document.createElement('input');
      inpEv.type = 'number'; inpEv.value = ficha.evasao;
      inpEv.addEventListener('input', () => { ficha.evasao = num(inpEv.value); agendarSalvar(); });
      const miniEv = document.createElement('span');
      miniEv.className = 'mini'; miniEv.textContent = 'Evasão';
      cxEvasao.appendChild(inpEv); cxEvasao.appendChild(miniEv);

      const comeca = document.createElement('div');
      comeca.className = 'comeca-em';
      comeca.append('Começa em ');
      const inpBase = document.createElement('input');
      inpBase.type = 'number'; inpBase.value = ficha.evasaoBase;
      inpBase.addEventListener('input', () => { ficha.evasaoBase = num(inpBase.value); agendarSalvar(); });
      comeca.appendChild(inpBase);

      linha.appendChild(cxEvasao);
      linha.appendChild(comeca);
      corpo.appendChild(linha);

      // Limiares de dano
      const nota = document.createElement('p');
      nota.className = 'limiares-nota';
      nota.textContent = 'Some seu nível atual aos seus limiares de dano.';
      corpo.appendChild(nota);

      const trilha = document.createElement('div');
      trilha.className = 'limiares-trilha';
      trilha.appendChild(pill('DANO MENOR', 'Marque 1 PV'));
      trilha.appendChild(seta());
      trilha.appendChild(campoLimiar('menor'));
      trilha.appendChild(seta());
      trilha.appendChild(pill('DANO MAIOR', 'Marque 2 PV'));
      trilha.appendChild(seta());
      trilha.appendChild(campoLimiar('maior'));
      trilha.appendChild(seta());
      trilha.appendChild(pill('DANO GRAVE', 'Marque 3 PV', true));
      corpo.appendChild(trilha);

      // Medidores
      const meds = document.createElement('div');
      meds.className = 'grade-recursos';
      meds.appendChild(cartaoMedidor('armadura', 'Pontos de Armadura', 'Estado da sua armadura; gaste para diminuir a quantia de PVs marcados', 'escudo', '#9a9a9a'));
      meds.appendChild(cartaoMedidor('vida', 'Pontos de Vida', 'Saúde Física; ao chegar a zero, você cai', 'coracao', '#e23b3b'));
      meds.appendChild(cartaoMedidor('fadiga', 'Pontos de Fadiga', 'Estresse mental; ao receber estresse sem ter PF para gastar, sua saúde física deteriora', 'triangulo', '#9d6bff'));
      meds.appendChild(cartaoMedidor('esperanca', 'Esperança', 'Gaste para usar uma experiência, prestar ajuda, iniciar um teste em dupla ou usar uma habilidade', 'estrela', '#f5c518'));
      corpo.appendChild(meds);
    }));

    // EXPERIÊNCIAS
    c.appendChild(secao('Experiências', (corpo) => {
      ficha.experiencias.forEach((exp, i) => {
        const linha = document.createElement('div');
        linha.className = 'linha-experiencia';
        const inpNome = document.createElement('input');
        inpNome.type = 'text'; inpNome.placeholder = 'Experiência ' + (i + 1); inpNome.value = exp.nome;
        inpNome.addEventListener('input', () => { exp.nome = inpNome.value; agendarSalvar(); });
        const inpBonus = document.createElement('input');
        inpBonus.type = 'number'; inpBonus.className = 'exp-bonus'; inpBonus.value = exp.bonus;
        inpBonus.addEventListener('input', () => { exp.bonus = num(inpBonus.value); agendarSalvar(); });
        linha.appendChild(inpNome);
        linha.appendChild(inpBonus);
        corpo.appendChild(linha);
      });
    }));

    // OURO
    c.appendChild(secao('Ouro', (corpo) => {
      const grade = document.createElement('div');
      grade.className = 'grade-ouro';
      [['Punhados', 'punhados'], ['Bolsas', 'bolsas'], ['Baús', 'baus']].forEach(([rotulo, chave]) => {
        const item = document.createElement('div');
        item.className = 'ouro-box';
        const lab = document.createElement('span'); lab.textContent = rotulo;
        const inp = document.createElement('input');
        inp.type = 'number'; inp.value = ficha.ouro[chave];
        inp.addEventListener('input', () => { ficha.ouro[chave] = num(inp.value); agendarSalvar(); });
        item.appendChild(lab); item.appendChild(inp);
        grade.appendChild(item);
      });
      corpo.appendChild(grade);
    }));
  }

  // Cartão de atributo com +/-
  function cartaoAtributo(rotulo, chave) {
    const cartao = document.createElement('div');
    cartao.className = 'cartao-atributo';
    const inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'valor'; inp.value = ficha.atributos[chave];
    inp.addEventListener('input', () => { ficha.atributos[chave] = num(inp.value); agendarSalvar(); });
    const label = document.createElement('span');
    label.className = 'rotulo'; label.textContent = rotulo;
    const botoes = document.createElement('div');
    botoes.className = 'attr-btns';
    const menos = document.createElement('button'); menos.className = 'attr-btn'; menos.textContent = '−';
    const mais = document.createElement('button'); mais.className = 'attr-btn'; mais.textContent = '+';
    menos.addEventListener('click', () => { ficha.atributos[chave]--; inp.value = ficha.atributos[chave]; agendarSalvar(); });
    mais.addEventListener('click', () => { ficha.atributos[chave]++; inp.value = ficha.atributos[chave]; agendarSalvar(); });
    botoes.appendChild(menos); botoes.appendChild(mais);
    cartao.appendChild(inp); cartao.appendChild(label); cartao.appendChild(botoes);
    return cartao;
  }

  function pill(titulo, sub, grave) {
    const d = document.createElement('div');
    d.className = 'pill' + (grave ? ' grave' : '');
    d.innerHTML = `<div class="pill-titulo">${titulo}</div><div class="pill-sub">${sub}</div>`;
    return d;
  }
  function seta() {
    const s = document.createElement('span');
    s.className = 'seta-limiar'; s.textContent = '►';
    return s;
  }
  function campoLimiar(chave) {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.className = 'limiar-num'; inp.value = ficha.limiares[chave];
    inp.addEventListener('input', () => { ficha.limiares[chave] = num(inp.value); agendarSalvar(); });
    return inp;
  }

  // Cartão de medidor com ícones togláveis e controle de quantidade
  function cartaoMedidor(chave, titulo, desc, tipoIcone, cor) {
    const rec = ficha.recursos[chave];
    const cartao = document.createElement('div');
    cartao.className = 'cartao-recurso';

    const h4 = document.createElement('h4');
    h4.textContent = titulo;
    const pDesc = document.createElement('div');
    pDesc.className = 'desc'; pDesc.textContent = desc;
    cartao.appendChild(h4);
    cartao.appendChild(pDesc);

    const icones = document.createElement('div');
    icones.className = 'icones-recurso';
    cartao.appendChild(icones);

    const ctrl = document.createElement('div');
    ctrl.className = 'controle-qtd';
    const bMenos = document.createElement('button'); bMenos.textContent = '−';
    const label = document.createElement('span'); label.className = 'qtd-label';
    const bMais = document.createElement('button'); bMais.textContent = '+';
    ctrl.appendChild(bMenos); ctrl.appendChild(label); ctrl.appendChild(bMais);
    cartao.appendChild(ctrl);

    function atualizarLabel() { label.textContent = rec.total + ' total'; }

    function desenharIcones() {
      icones.innerHTML = '';
      for (let i = 0; i < rec.total; i++) {
        const ic = document.createElement('div');
        ic.className = 'icone-recurso';
        ic.innerHTML = svgIcone(tipoIcone, rec.estados[i], cor);
        ic.addEventListener('click', () => {
          rec.estados[i] = !rec.estados[i];
          ic.innerHTML = svgIcone(tipoIcone, rec.estados[i], cor);
          agendarSalvar();
        });
        icones.appendChild(ic);
      }
    }
    function ajustar(delta) {
      const novo = Math.max(0, Math.min(20, rec.total + delta));
      if (novo === rec.total) return;
      if (novo > rec.total) {
        while (rec.estados.length < novo) rec.estados.push(false);
      } else {
        rec.estados.length = novo;
      }
      rec.total = novo;
      atualizarLabel();
      desenharIcones();
      agendarSalvar();
    }
    bMenos.addEventListener('click', () => ajustar(-1));
    bMais.addEventListener('click', () => ajustar(1));
    atualizarLabel();
    desenharIcones();
    return cartao;
  }

  // ----- PAINEL DIREITO: HABILIDADES ---------------------------------
  function renderHabilidades() {
    const c = $('#aba-habilidades');
    c.innerHTML = '';
    ficha.habilidades.forEach((hab, i) => c.appendChild(accordionHabilidade(hab, i)));
    const add = document.createElement('button');
    add.className = 'btn-adicionar';
    add.textContent = '+ Adicionar Habilidade';
    add.addEventListener('click', () => {
      ficha.habilidades.push({ titulo: 'Nova habilidade', ativa: false, custo: '1 Esperança', descricao: '' });
      renderHabilidades(); agendarSalvar();
    });
    c.appendChild(add);
  }

  function accordionHabilidade(hab, i) {
    const ac = document.createElement('div');
    ac.className = 'accordion';

    const cab = document.createElement('div');
    cab.className = 'accordion-cabeca';

    const inpTitulo = document.createElement('input');
    inpTitulo.className = 'accordion-titulo';
    inpTitulo.value = hab.titulo;
    inpTitulo.addEventListener('click', (e) => e.stopPropagation());
    inpTitulo.addEventListener('input', () => { hab.titulo = inpTitulo.value; agendarSalvar(); });

    const status = document.createElement('button');
    status.type = 'button';
    status.className = 'btn-status' + (hab.ativa ? ' ativa' : '');
    status.dataset.tooltip = 'Custo p/ trocar: ' + (hab.custo || '1 Esperança');
    status.title = hab.ativa ? 'Ativa' : 'Inativa';
    status.addEventListener('click', (e) => {
      e.stopPropagation();
      hab.ativa = !hab.ativa;
      status.classList.toggle('ativa', hab.ativa);
      status.title = hab.ativa ? 'Ativa' : 'Inativa';
      agendarSalvar();
    });

    const remover = document.createElement('button');
    remover.className = 'btn-remover-card'; remover.textContent = '🗑';
    remover.title = 'Remover habilidade';
    remover.addEventListener('click', (e) => {
      e.stopPropagation();
      ficha.habilidades.splice(i, 1); renderHabilidades(); agendarSalvar();
    });

    const chevron = document.createElement('span');
    chevron.className = 'chevron'; chevron.innerHTML = chevronSVG();

    cab.appendChild(inpTitulo);
    cab.appendChild(status);
    cab.appendChild(remover);
    cab.appendChild(chevron);

    const corpo = document.createElement('div');
    corpo.className = 'accordion-corpo';
    const desc = document.createElement('textarea');
    desc.placeholder = 'Descrição da regra da habilidade…';
    desc.value = hab.descricao;
    desc.addEventListener('input', () => { hab.descricao = desc.value; agendarSalvar(); });
    corpo.appendChild(desc);

    cab.addEventListener('click', () => ac.classList.toggle('aberto'));
    ac.appendChild(cab); ac.appendChild(corpo);
    return ac;
  }

  // ----- PAINEL DIREITO: EQUIPAMENTOS --------------------------------
  function renderEquipamentos() {
    const c = $('#aba-equipamentos');
    c.innerHTML = '';

    // ARMAS
    c.appendChild(secao('Armas', (corpo) => {
      // Proficiência
      const lblProf = document.createElement('div');
      lblProf.className = 'subtitulo'; lblProf.style.marginTop = '0';
      lblProf.textContent = 'Proficiência';
      corpo.appendChild(lblProf);
      const prof = document.createElement('div');
      prof.className = 'proficiencia';
      ficha.armas.proficiencia.forEach((preenchido, i) => {
        const ci = document.createElement('div');
        ci.className = 'circulo-prof' + (preenchido ? ' preenchido' : '');
        ci.addEventListener('click', () => {
          ficha.armas.proficiencia[i] = !ficha.armas.proficiencia[i];
          ci.classList.toggle('preenchido', ficha.armas.proficiencia[i]);
          agendarSalvar();
        });
        prof.appendChild(ci);
      });
      corpo.appendChild(prof);

      corpo.appendChild(blocoArma('Principal', ficha.armas.principal));
      corpo.appendChild(blocoArma('Secundária', ficha.armas.secundaria));
    }));

    // ARMADURA
    c.appendChild(secao('Armadura', (corpo) => {
      const bloco = document.createElement('div');
      bloco.className = 'bloco-equip';
      bloco.appendChild(campoRotulado('Nome', textInput(ficha.armadura.nome, (v) => { ficha.armadura.nome = v; agendarSalvar(); })));
      bloco.appendChild(campoRotulado('Limiares Base', textInput(ficha.armadura.limiaresBase, (v) => { ficha.armadura.limiaresBase = v; agendarSalvar(); })));
      bloco.appendChild(campoRotulado('Pontos de Armadura Base', numInput(ficha.armadura.pontosBase, (v) => { ficha.armadura.pontosBase = v; agendarSalvar(); })));
      bloco.appendChild(accordionHabEquip(ficha.armadura, 'habNome', 'habDesc'));
      corpo.appendChild(bloco);
    }));

    // INVENTÁRIO
    c.appendChild(secao('Inventário', (corpo) => {
      const lista = document.createElement('div');
      ficha.inventario.forEach((item, i) => lista.appendChild(accordionItem(ficha.inventario, item, i, 'Nome do item', 'Descrição do item…', () => renderEquipamentos())));
      corpo.appendChild(lista);
      const add = document.createElement('button');
      add.className = 'btn-adicionar'; add.textContent = '+ Adicionar Item';
      add.addEventListener('click', () => {
        ficha.inventario.push({ nome: 'Novo item', descricao: '', aberto: true });
        renderEquipamentos(); agendarSalvar();
      });
      corpo.appendChild(add);
    }));
  }

  function blocoArma(titulo, arma) {
    const bloco = document.createElement('div');
    bloco.className = 'bloco-equip';
    const t = document.createElement('div');
    t.className = 'subtitulo'; t.style.marginTop = '0'; t.textContent = titulo;
    bloco.appendChild(t);

    bloco.appendChild(campoRotulado('Nome', textInput(arma.nome, (v) => { arma.nome = v; agendarSalvar(); })));
    bloco.appendChild(campoRotulado('Atributo', selectInput(
      ['Força', 'Agilidade', 'Acuidade', 'Instinto', 'Conhecimento', 'Presença'],
      arma.atributo, (v) => { arma.atributo = v; agendarSalvar(); })));
    bloco.appendChild(campoRotulado('Alcance', selectInput(
      ['Corpo a Corpo', 'Muito Próximo', 'Próximo', 'Distante', 'Muito Distante'],
      arma.alcance, (v) => { arma.alcance = v; agendarSalvar(); })));
    bloco.appendChild(campoRotulado('Dados / tipo de dano', textInput(arma.dados, (v) => { arma.dados = v; agendarSalvar(); })));
    bloco.appendChild(accordionHabEquip(arma, 'habNome', 'habDesc'));
    return bloco;
  }

  // Accordion de "habilidade" embutida em arma/armadura
  function accordionHabEquip(obj, chaveNome, chaveDesc) {
    const ac = document.createElement('div');
    ac.className = 'accordion';
    ac.style.marginTop = '6px';

    const cab = document.createElement('div');
    cab.className = 'accordion-cabeca';
    const inpNome = document.createElement('input');
    inpNome.className = 'accordion-titulo';
    inpNome.placeholder = 'Habilidade';
    inpNome.value = obj[chaveNome] || '';
    inpNome.addEventListener('click', (e) => e.stopPropagation());
    inpNome.addEventListener('input', () => { obj[chaveNome] = inpNome.value; agendarSalvar(); });
    const chevron = document.createElement('span');
    chevron.className = 'chevron'; chevron.innerHTML = chevronSVG();
    cab.appendChild(inpNome); cab.appendChild(chevron);

    const corpo = document.createElement('div');
    corpo.className = 'accordion-corpo';
    const desc = document.createElement('textarea');
    desc.placeholder = 'Descrição da habilidade…';
    desc.value = obj[chaveDesc] || '';
    desc.addEventListener('input', () => { obj[chaveDesc] = desc.value; agendarSalvar(); });
    corpo.appendChild(desc);

    cab.addEventListener('click', () => ac.classList.toggle('aberto'));
    ac.appendChild(cab); ac.appendChild(corpo);
    return ac;
  }

  // Accordion genérico de item (inventário / anotação)
  function accordionItem(lista, item, i, phNome, phDesc, reRender) {
    const ac = document.createElement('div');
    ac.className = 'accordion' + (item.aberto ? ' aberto' : '');

    const cab = document.createElement('div');
    cab.className = 'accordion-cabeca';
    const inpNome = document.createElement('input');
    inpNome.className = 'accordion-titulo';
    inpNome.placeholder = phNome;
    inpNome.value = item.nome !== undefined ? item.nome : (item.titulo || '');
    inpNome.addEventListener('click', (e) => e.stopPropagation());
    inpNome.addEventListener('input', () => {
      if (item.nome !== undefined) item.nome = inpNome.value; else item.titulo = inpNome.value;
      agendarSalvar();
    });

    const remover = document.createElement('button');
    remover.className = 'btn-remover-card'; remover.textContent = '🗑';
    remover.addEventListener('click', (e) => {
      e.stopPropagation();
      lista.splice(i, 1); reRender(); agendarSalvar();
    });
    const chevron = document.createElement('span');
    chevron.className = 'chevron'; chevron.innerHTML = chevronSVG();

    cab.appendChild(inpNome); cab.appendChild(remover); cab.appendChild(chevron);

    const corpo = document.createElement('div');
    corpo.className = 'accordion-corpo';
    const desc = document.createElement('textarea');
    desc.placeholder = phDesc;
    const chaveDesc = item.descricao !== undefined ? 'descricao' : 'conteudo';
    desc.value = item[chaveDesc] || '';
    desc.addEventListener('input', () => { item[chaveDesc] = desc.value; agendarSalvar(); });
    corpo.appendChild(desc);

    cab.addEventListener('click', () => {
      ac.classList.toggle('aberto');
      item.aberto = ac.classList.contains('aberto');
    });
    ac.appendChild(cab); ac.appendChild(corpo);
    return ac;
  }

  // ----- PAINEL DIREITO: ANOTAÇÕES -----------------------------------
  function renderAnotacoes() {
    const c = $('#aba-anotacoes');
    c.innerHTML = '';
    const lista = document.createElement('div');
    ficha.anotacoes.forEach((nota, i) =>
      lista.appendChild(accordionItem(ficha.anotacoes, nota, i, 'Título da anotação', 'Escreva sua anotação…', () => renderAnotacoes()))
    );
    c.appendChild(lista);
    const add = document.createElement('button');
    add.className = 'btn-adicionar'; add.textContent = '+ Adicionar Anotação';
    add.addEventListener('click', () => {
      ficha.anotacoes.push({ titulo: 'Nova anotação', conteudo: '', aberto: true });
      renderAnotacoes(); agendarSalvar();
    });
    c.appendChild(add);
  }

  // ===================================================================
  // Helpers de UI
  // ===================================================================
  function campoTexto(rotulo, valor, onInput) {
    const wrap = document.createElement('label');
    wrap.className = 'campo';
    const span = document.createElement('span'); span.textContent = rotulo;
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = valor || '';
    inp.addEventListener('input', () => onInput(inp.value));
    wrap.appendChild(span); wrap.appendChild(inp);
    return wrap;
  }
  function textInput(valor, onInput) {
    const inp = document.createElement('input');
    inp.type = 'text'; inp.value = valor || '';
    inp.addEventListener('input', () => onInput(inp.value));
    return inp;
  }
  function numInput(valor, onInput) {
    const inp = document.createElement('input');
    inp.type = 'number'; inp.value = valor || 0;
    inp.addEventListener('input', () => onInput(num(inp.value)));
    return inp;
  }
  function selectInput(opcoes, valor, onChange) {
    const sel = document.createElement('select');
    opcoes.forEach((o) => {
      const op = document.createElement('option');
      op.value = o; op.textContent = o; if (o === valor) op.selected = true;
      sel.appendChild(op);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  // Campo rotulado em coluna (reutiliza a classe .campo do CSS)
  function campoRotulado(rotulo, elemento) {
    const wrap = document.createElement('label');
    wrap.className = 'campo';
    const span = document.createElement('span'); span.textContent = rotulo;
    wrap.appendChild(span); wrap.appendChild(elemento);
    return wrap;
  }
  function secao(titulo, preencher) {
    const sec = document.createElement('div');
    const tit = document.createElement('div');
    tit.className = 'titulo-secao'; tit.textContent = titulo;
    sec.appendChild(tit);
    const corpo = document.createElement('div');
    preencher(corpo);
    sec.appendChild(corpo);
    return sec;
  }

  const num = (v) => { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; };
  const escapar = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ----- Ícones SVG --------------------------------------------------
  function svgIcone(tipo, preenchido, cor) {
    const caminhos = {
      escudo: 'M12 2 L20 5 V11 C20 16 16 20 12 22 C8 20 4 16 4 11 V5 Z',
      coracao: 'M12 21 C12 21 4 14 4 8.5 A4 4 0 0 1 12 6 A4 4 0 0 1 20 8.5 C20 14 12 21 12 21 Z',
      triangulo: 'M12 3 L21 20 H3 Z',
      estrela: 'M12 2 L14.7 8.6 L21.8 9.2 L16.4 13.8 L18.1 20.7 L12 17 L5.9 20.7 L7.6 13.8 L2.2 9.2 L9.3 8.6 Z',
    };
    const d = caminhos[tipo];
    const fill = preenchido ? cor : 'none';
    const stroke = preenchido ? cor : 'rgba(255,255,255,.35)';
    return `<svg viewBox="0 0 24 24"><path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
  function iconeCamera() {
    return `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 9a2 2 0 0 1 2-2h2l1.5-2h7L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.2"/></svg>`;
  }
  function chevronSVG() {
    return `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>`;
  }

  // ===================================================================
  // Boot
  // ===================================================================
  function iniciarApp() {
    if (token && usuario) {
      carregarLista();
      mostrarTela('tela-lista');
    } else {
      mostrarAuth();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    configurarAuth();
    configurarLista();
    configurarFicha();
    iniciarApp();
  });
})();