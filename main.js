

// Biblioteca
const express = require('express'); // framework para criar servidores HTTP
const mysql = require('mysql2/promise'); // conectar com o banco de forma assíncrona
const bcrypt = require('bcryptjs'); // Criptografa senha
require('dotenv').config(); // Carrega variáveis de .env

const app = express();
app.use(express.json()); // Middleware para a API entender requisições com corpo em JSON

//  "pool" de conexões para otimizar o desempenho
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// middleware de aut
// validar (JSON Web Token)
// garante que o usuário está logado e perm para isso
const autenticarUsuario = (req, res, next) => {
  const userId = req.headers['x-user-id']; // ID do pai logado viria no cabeçalho
  if (!userId) {
    return res.status(401).json({ message: 'Acesso não autorizado. ID de usuário ausente.' });
  }
  req.paiId = parseInt(userId, 10); // Adiciona o ID do pai ao objeto da requisição
  next(); // Continua para a próxima função (o endpoint)
};

// Rotas filhos

/**
 * @route   POST /filhos
 * @desc    Cadastra filho e associa ao pai logado
 * @access
 */
app.post('/filhos', autenticarUsuario, async (req, res) => {
  const { nome_completo, cpf, data_nascimento } = req.body;
  const paiId = req.paiId; // ID do pai obtido pelo middleware de aut

  if (!nome_completo || !cpf || !data_nascimento) {
    return res.status(400).json({ message: 'Todos os campos são obrigatórios: nome_completo, cpf, data_nascimento.' });
  }

  // ATENÇÃO: CPF criptografado de forma reversível
  const cpfCriptografado = cpf;

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction(); // Inicia uma transação

    // Insere filho na tabela 'Filhos'
    const [filhoResult] = await connection.execute(
      'INSERT INTO Filhos (nome_completo, cpf_criptografado, data_nascimento) VALUES (?, ?, ?)',
      [nome_completo, cpfCriptografado, data_nascimento]
    );
    const novoFilhoId = filhoResult.insertId;

    // Associa filho ao pai na tabela 'Pais_Filhos'
    await connection.execute(
      'INSERT INTO Pais_Filhos (pai_id, filho_id) VALUES (?, ?)',
      [paiId, novoFilhoId]
    );

    await connection.commit(); // Conf operação se tudo deu certo

    res.status(201).json({ id: novoFilhoId, nome_completo, message: 'Filho cadastrado com sucesso!' });
  } catch (error) {
    if (connection) await connection.rollback(); // Desfaz em caso de erro
    console.error('Erro ao cadastrar filho:', error);
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ message: 'Erro: CPF já cadastrado.' });
    }
    res.status(500).json({ message: 'Erro interno no servidor.' });
  } finally {
    if (connection) connection.release(); // Libera a conexão de volta para o pool
  }
});

/**
 * @route   DELETE /filhos/:id
 * @desc    Deleta egistro de um filho
 * @access  Privado
 */
app.delete('/filhos/:id', autenticarUsuario, async (req, res) => {
    const filhoId = req.params.id;
    const paiId = req.paiId;

    // garante q 'paiId' tem perm para deletar 'filhoId'

    try {
        const [result] = await pool.execute('DELETE FROM Filhos WHERE id = ?', [filhoId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Filho não encontrado.' });
        }

        // A regra "ON DELETE CASCADE" no bd, remove os registros
        // de 'Pais_Filhos' e 'Agendamentos'

        res.status(200).json({ message: 'Filho deletado com sucesso.' });
    } catch (error) {
        console.error('Erro ao deletar filho:', error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});


// rotas agendamento

/**
 * @route   POST /agendamentos
 * @desc    Criar agendamento para filho
 * @access  Privado
 */
app.post('/agendamentos', autenticarUsuario, async (req, res) => {
    const { filho_id, titulo, descricao, data_inicio, data_fim, tipo } = req.body;
    const criadoPorPaiId = req.paiId;

    if (!filho_id || !titulo || !data_inicio || !data_fim || !tipo) {
        return res.status(400).json({ message: 'Campos obrigatórios: filho_id, titulo, data_inicio, data_fim, tipo.' });
    }

    try {
        const [result] = await pool.execute(
            'INSERT INTO Agendamentos (filho_id, criado_por_pai_id, titulo, descricao, data_inicio, data_fim, tipo) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [filho_id, criadoPorPaiId, titulo, descricao, data_inicio, data_fim, tipo]
        );
        res.status(201).json({ id: result.insertId, message: 'Agendamento criado com sucesso.' });
    } catch (error) {
        console.error('Erro ao criar agendamento:', error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

/**
 * @route   GET /filhos/:id/agendamentos
 * @desc    Listar todos os agendamentos de um filho específico
 * @access  Privado
 */
app.get('/filhos/:id/agendamentos', autenticarUsuario, async (req, res) => {
    const filhoId = req.params.id;
    // Add verificação se pai tem acesso a filho

    try {
        const [agendamentos] = await pool.execute(
            'SELECT * FROM Agendamentos WHERE filho_id = ? ORDER BY data_inicio ASC',
            [filhoId]
        );
        res.status(200).json(agendamentos);
    } catch (error) {
        console.error('Erro ao listar agendamentos:', error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});

/**
 * @route   DELETE /agendamentos/:id
 * @desc    Deletar agendamento
 * @access  Privado
 */
app.delete('/agendamentos/:id', autenticarUsuario, async (req, res) => {
    const agendamentoId = req.params.id;
    //  Add verificação se pai tem perm para deletar agendamento

    try {
        const [result] = await pool.execute('DELETE FROM Agendamentos WHERE id = ?', [agendamentoId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Agendamento não encontrado.' });
        }

        res.status(200).json({ message: 'Agendamento deletado com sucesso.' });
    } catch (error) {
        console.error('Erro ao deletar agendamento:', error);
        res.status(500).json({ message: 'Erro interno no servidor.' });
    }
});


// iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    try {
        await pool.query('SELECT 1');
        console.log('✅ Conexão com o banco de dados MySQL bem-sucedida!');
        console.log(`🚀 Servidor da API rodando na porta ${PORT}`);
    } catch (error) {
        console.error('❌ Erro ao conectar com o banco de dados:', error);
    }
});
