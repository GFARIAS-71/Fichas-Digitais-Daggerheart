/* ============================================================================
 *  server.js — Back-end da Ficha de Personagem Digital (RPG de mesa)
 *  ----------------------------------------------------------------------------
 *  Stack: Node.js + Express + PostgreSQL (driver `pg`) + bcryptjs + JWT
 *
 *  PERSISTÊNCIA: exclusivamente em banco de dados remoto/hospedado na nuvem.
 *  Nenhum dado de usuário ou personagem é gravado em arquivo/disco local.
 *
 *  ----------------------------------------------------------------------------
 *  COMO CONFIGURAR (variáveis de ambiente)
 *  ----------------------------------------------------------------------------
 *  1) DATABASE_URL  -> string de conexão do seu PostgreSQL remoto.
 *
 *     Serviços gratuitos/recomendados (escolha UM e crie um projeto Postgres):
 *       • Supabase  -> https://supabase.com   (Project Settings > Database)
 *       • Neon      -> https://neon.tech
 *       • Railway   -> https://railway.app    (plugin PostgreSQL)
 *
 *     Exemplo de formato:
 *       postgresql://usuario:senha@host:5432/nome_do_banco?sslmode=require
 *
 *  2) JWT_SECRET    -> segredo para assinar os tokens (qualquer string longa).
 *  3) PORT          -> opcional (padrão 3000).
 *
 *     No Linux/macOS:
 *       export DATABASE_URL="postgresql://..."
 *       export JWT_SECRET="troque-este-segredo"
 *
 *  ----------------------------------------------------------------------------
 *  COMO RODAR
 *  ----------------------------------------------------------------------------
 *     npm install
 *     export DATABASE_URL="postgresql://..."
 *     export JWT_SECRET="..."
 *     npm start          # cria as tabelas (initDb) e sobe o servidor
 *
 *  IMPORTANTE: este arquivo usa CommonJS (require/module.exports). Garanta que
 *  o package.json NÃO contenha "type": "module" (ou remova essa linha).
 * ==========================================================================*/

'use strict';

import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pg from 'pg';

const { hash, compare } = bcryptjs;
const { verify, sign } = jwt;
const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-troque-em-producao';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error(
    '\n[ERRO] A variável de ambiente DATABASE_URL não está definida.\n' +
    'Defina a string de conexão do seu PostgreSQL remoto (Supabase/Neon/Railway).\n' +
    'Ex.: export DATABASE_URL="postgresql://user:pass@host:5432/db?sslmode=require"\n'
  );
  // Não encerramos imediatamente para permitir importar o módulo em testes,
  // mas qualquer rota que toque o banco falhará até a variável ser configurada.
}

/* ---------------------------------------------------------------------------
 *  Pool de conexões com o PostgreSQL remoto.
 *  A maioria dos provedores em nuvem exige SSL. Mantemos rejectUnauthorized
 *  false para compatibilidade com certificados gerenciados desses serviços.
 * ------------------------------------------------------------------------- */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: DATABASE_URL && DATABASE_URL.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

/* ---------------------------------------------------------------------------
 *  initDb — cria as tabelas caso não existam (idempotente).
 * ------------------------------------------------------------------------- */
async function initDb() {
  const sql = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id            SERIAL PRIMARY KEY,
      nome_usuario  TEXT NOT NULL UNIQUE,
      senha_hash    TEXT NOT NULL,
      papel         TEXT NOT NULL CHECK (papel IN ('jogador', 'mestre')),
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS personagens (
      id            SERIAL PRIMARY KEY,
      jogador_id    INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      mestre_id     INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
      dados         JSONB NOT NULL DEFAULT '{}'::jsonb,
      criado_em     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_personagens_jogador ON personagens(jogador_id);
    CREATE INDEX IF NOT EXISTS idx_personagens_mestre  ON personagens(mestre_id);
  `;
  await pool.query(sql);
  console.log('[db] Tabelas verificadas/criadas com sucesso.');
}

/* ===========================================================================
 *  App Express
 * ========================================================================= */
const app = express();
app.use(cors());
app.use(express.json({ limit: '8mb' })); // limite generoso p/ imagem base64 da ficha

// Servir o front-end estático (index.html, style.css, script.js) a partir
// da mesma pasta deste arquivo.
app.use(express.static(__dirname));

/* ---------------------------------------------------------------------------
 *  Logout sem disco: mantemos uma blocklist de tokens revogados EM MEMÓRIA.
 *  (Nenhuma sessão é gravada em arquivo.) Tokens expiram naturalmente pelo JWT.
 * ------------------------------------------------------------------------- */
const tokensRevogados = new Set();

/* ---------------------------------------------------------------------------
 *  Middleware de autenticação: valida o JWT do header Authorization a cada
 *  requisição protegida. O payload contém { id, papel, nome_usuario }.
 * ------------------------------------------------------------------------- */
function autenticar(req, res, next) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ erro: 'Token de autenticação ausente.' });
  }
  if (tokensRevogados.has(token)) {
    return res.status(401).json({ erro: 'Sessão encerrada. Faça login novamente.' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.usuario = payload;   // { id, papel, nome_usuario }
    req.token = token;
    next();
  } catch (e) {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}

/* ---------------------------------------------------------------------------
 *  Helper: carrega um personagem e checa permissão (dono OU mestre associado).
 *  Retorna o personagem ou envia a resposta de erro apropriada e retorna null.
 * ------------------------------------------------------------------------- */
async function carregarPersonagemComPermissao(req, res, { exigirDono = false } = {}) {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ erro: 'ID de personagem inválido.' });
    return null;
  }

  const { rows } = await pool.query('SELECT * FROM personagens WHERE id = $1', [id]);
  if (rows.length === 0) {
    res.status(404).json({ erro: 'Personagem não encontrado.' });
    return null;
  }

  const personagem = rows[0];
  const ehDono = personagem.jogador_id === req.usuario.id;
  const ehMestre = personagem.mestre_id === req.usuario.id;

  if (exigirDono) {
    if (!ehDono) {
      res.status(403).json({ erro: 'Apenas o dono pode realizar esta ação.' });
      return null;
    }
  } else if (!ehDono && !ehMestre) {
    res.status(403).json({ erro: 'Você não tem permissão sobre este personagem.' });
    return null;
  }

  return personagem;
}

/* ===========================================================================
 *  ROTAS DE AUTENTICAÇÃO
 * ========================================================================= */

// POST /api/registro — cria novo usuário (jogador ou mestre)
app.post('/api/registro', async (req, res) => {
  try {
    const { nome_usuario, senha, papel } = req.body || {};

    if (!nome_usuario || !senha || !papel) {
      return res.status(400).json({ erro: 'Informe nome de usuário, senha e papel.' });
    }
    if (!['jogador', 'mestre'].includes(papel)) {
      return res.status(400).json({ erro: 'Papel deve ser "jogador" ou "mestre".' });
    }
    if (String(senha).length < 4) {
      return res.status(400).json({ erro: 'A senha deve ter ao menos 4 caracteres.' });
    }

    const senha_hash = await hash(String(senha), 10);

    const { rows } = await pool.query(
      `INSERT INTO usuarios (nome_usuario, senha_hash, papel)
       VALUES ($1, $2, $3)
       RETURNING id, nome_usuario, papel`,
      [String(nome_usuario).trim(), senha_hash, papel]
    );

    return res.status(201).json({ usuario: rows[0] });
  } catch (e) {
    if (e.code === '23505') { // unique_violation
      return res.status(409).json({ erro: 'Esse nome de usuário já existe.' });
    }
    console.error('[registro]', e);
    return res.status(500).json({ erro: 'Erro ao criar conta.' });
  }
});

// POST /api/login — autentica e retorna JWT
app.post('/api/login', async (req, res) => {
  try {
    const { nome_usuario, senha } = req.body || {};
    if (!nome_usuario || !senha) {
      return res.status(400).json({ erro: 'Informe nome de usuário e senha.' });
    }

    const { rows } = await pool.query(
      'SELECT * FROM usuarios WHERE nome_usuario = $1',
      [String(nome_usuario).trim()]
    );
    if (rows.length === 0) {
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }

    const usuario = rows[0];
    const ok = await compare(String(senha), usuario.senha_hash);
    if (!ok) {
      return res.status(401).json({ erro: 'Usuário ou senha inválidos.' });
    }

    const token = jwt.sign(
      { id: usuario.id, papel: usuario.papel, nome_usuario: usuario.nome_usuario },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      token,
      usuario: { id: usuario.id, nome_usuario: usuario.nome_usuario, papel: usuario.papel },
    });
  } catch (e) {
    console.error('[login]', e);
    return res.status(500).json({ erro: 'Erro ao autenticar.' });
  }
});

// POST /api/logout — revoga o token atual (blocklist em memória)
app.post('/api/logout', autenticar, (req, res) => {
  tokensRevogados.add(req.token);
  return res.json({ ok: true });
});

/* ===========================================================================
 *  ROTAS DE PERSONAGENS
 * ========================================================================= */

// GET /api/personagens — lista conforme papel do usuário logado
app.get('/api/personagens', autenticar, async (req, res) => {
  try {
    let result;
    if (req.usuario.papel === 'mestre') {
      // Mestre: todos os personagens que o associaram como mestre.
      result = await pool.query(
        `SELECT p.id, p.dados, p.jogador_id, p.mestre_id,
                u.nome_usuario AS dono, m.nome_usuario AS nome_mestre
           FROM personagens p
           JOIN usuarios u ON u.id = p.jogador_id
           LEFT JOIN usuarios m ON m.id = p.mestre_id
          WHERE p.mestre_id = $1
          ORDER BY p.atualizado_em DESC`,
        [req.usuario.id]
      );
    } else {
      // Jogador: apenas os próprios personagens.
      result = await pool.query(
        `SELECT p.id, p.dados, p.jogador_id, p.mestre_id,
                u.nome_usuario AS dono, m.nome_usuario AS nome_mestre
           FROM personagens p
           JOIN usuarios u ON u.id = p.jogador_id
           LEFT JOIN usuarios m ON m.id = p.mestre_id
          WHERE p.jogador_id = $1
          ORDER BY p.atualizado_em DESC`,
        [req.usuario.id]
      );
    }

    // Resposta enxuta para os cartões da lista.
    const lista = result.rows.map((p) => ({
      id: p.id,
      nome: p.dados?.nome || 'Sem nome',
      classe: p.dados?.classe || '',
      dono: p.dono,
      nome_mestre: p.nome_mestre || null,
      jogador_id: p.jogador_id,
      mestre_id: p.mestre_id,
      imagem: p.dados?.imagem || null,
    }));

    return res.json({ personagens: lista });
  } catch (e) {
    console.error('[lista personagens]', e);
    return res.status(500).json({ erro: 'Erro ao listar personagens.' });
  }
});

// POST /api/personagens — cria novo personagem (apenas jogador)
app.post('/api/personagens', autenticar, async (req, res) => {
  try {
    if (req.usuario.papel !== 'jogador') {
      return res.status(403).json({ erro: 'Apenas jogadores podem criar personagens.' });
    }

    const dados = (req.body && req.body.dados) || {};
    const nomeMestre = req.body && req.body.nome_mestre; // opcional na criação

    let mestre_id = null;
    if (nomeMestre) {
      const { rows } = await pool.query(
        `SELECT id FROM usuarios WHERE nome_usuario = $1 AND papel = 'mestre'`,
        [String(nomeMestre).trim()]
      );
      if (rows.length === 0) {
        return res.status(404).json({ erro: 'Mestre informado não encontrado.' });
      }
      mestre_id = rows[0].id;
    }

    const { rows } = await pool.query(
      `INSERT INTO personagens (jogador_id, mestre_id, dados)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [req.usuario.id, mestre_id, dados]
    );

    return res.status(201).json({ id: rows[0].id });
  } catch (e) {
    console.error('[criar personagem]', e);
    return res.status(500).json({ erro: 'Erro ao criar personagem.' });
  }
});

// GET /api/personagens/:id — dados completos (dono ou mestre associado)
app.get('/api/personagens/:id', autenticar, async (req, res) => {
  try {
    const personagem = await carregarPersonagemComPermissao(req, res);
    if (!personagem) return; // resposta de erro já enviada

    // Nome do mestre (se houver) para exibir no front.
    let nome_mestre = null;
    if (personagem.mestre_id) {
      const { rows } = await pool.query(
        'SELECT nome_usuario FROM usuarios WHERE id = $1',
        [personagem.mestre_id]
      );
      nome_mestre = rows[0]?.nome_usuario || null;
    }

    return res.json({
      id: personagem.id,
      jogador_id: personagem.jogador_id,
      mestre_id: personagem.mestre_id,
      nome_mestre,
      dados: personagem.dados || {},
      sou_dono: personagem.jogador_id === req.usuario.id,
      sou_mestre: personagem.mestre_id === req.usuario.id,
    });
  } catch (e) {
    console.error('[obter personagem]', e);
    return res.status(500).json({ erro: 'Erro ao carregar personagem.' });
  }
});

// PUT /api/personagens/:id — atualiza dados (dono ou mestre associado)
app.put('/api/personagens/:id', autenticar, async (req, res) => {
  try {
    const personagem = await carregarPersonagemComPermissao(req, res);
    if (!personagem) return;

    const dados = (req.body && req.body.dados) || {};

    await pool.query(
      `UPDATE personagens
          SET dados = $1, atualizado_em = NOW()
        WHERE id = $2`,
      [dados, personagem.id]
    );

    return res.json({ ok: true });
  } catch (e) {
    console.error('[atualizar personagem]', e);
    return res.status(500).json({ erro: 'Erro ao salvar personagem.' });
  }
});

// DELETE /api/personagens/:id — remove (apenas dono)
app.delete('/api/personagens/:id', autenticar, async (req, res) => {
  try {
    const personagem = await carregarPersonagemComPermissao(req, res, { exigirDono: true });
    if (!personagem) return;

    await pool.query('DELETE FROM personagens WHERE id = $1', [personagem.id]);
    return res.json({ ok: true });
  } catch (e) {
    console.error('[deletar personagem]', e);
    return res.status(500).json({ erro: 'Erro ao remover personagem.' });
  }
});

// POST /api/personagens/:id/vincular-mestre — associa um mestre (apenas dono)
app.post('/api/personagens/:id/vincular-mestre', autenticar, async (req, res) => {
  try {
    const personagem = await carregarPersonagemComPermissao(req, res, { exigirDono: true });
    if (!personagem) return;

    const nomeMestre = req.body && req.body.nome_mestre;
    if (!nomeMestre) {
      return res.status(400).json({ erro: 'Informe o nome de usuário do mestre.' });
    }

    const { rows } = await pool.query(
      `SELECT id FROM usuarios WHERE nome_usuario = $1 AND papel = 'mestre'`,
      [String(nomeMestre).trim()]
    );
    if (rows.length === 0) {
      return res.status(404).json({ erro: 'Mestre não encontrado.' });
    }

    await pool.query(
      'UPDATE personagens SET mestre_id = $1, atualizado_em = NOW() WHERE id = $2',
      [rows[0].id, personagem.id]
    );

    return res.json({ ok: true, mestre_id: rows[0].id, nome_mestre: String(nomeMestre).trim() });
  } catch (e) {
    console.error('[vincular mestre]', e);
    return res.status(500).json({ erro: 'Erro ao vincular mestre.' });
  }
});

/* ===========================================================================
 *  Fallback: qualquer rota não-API devolve o index.html (SPA simples).
 * ========================================================================= */
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

/* ===========================================================================
 *  Inicialização
 * ========================================================================= */
async function iniciar() {
  try {
    if (DATABASE_URL) {
      await initDb();
    } else {
      console.warn('[aviso] Subindo sem DATABASE_URL — configure-a antes de usar a API.');
    }
    app.listen(PORT, () => {
      console.log(`\n🜲  Ficha de RPG rodando em http://localhost:${5432}\n`);
    });
  } catch (e) {
    console.error('[fatal] Falha ao iniciar:', e);
    process.exit(1);
  }
}

// Só inicia automaticamente quando executado diretamente (node server.js).
iniciar();

export default { app, pool, initDb };