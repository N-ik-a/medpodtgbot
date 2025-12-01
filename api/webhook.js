const TelegramBot = require('node-telegram-bot-api');

// Токен бота — проверь, что он установлен в Vercel
const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN не установлен!');
  process.exit(1);
}

const bot = new TelegramBot(token);

// Для хранения состояния викторины (в памяти — fallback, лучше использовать KV)
let userQuizProgress = {}; // { userId: { currentQuestion: 0, currentPollId: null, answers: [] } }

// Если есть KV (Vercel KV), используй его вместо памяти
const { createClient } = require('@vercel/kv');
let kv;
if (process.env.KV_URL) {
  kv = createClient({ url: process.env.KV_URL });
}

// Вопросы викторины — fallback, если JSON нет
const defaultQuestions = [
  { question: 'Вопрос 1?', options: ['A', 'B', 'C', 'D'], correct: 0 },
  // Добавь остальные вопросы или загружай из JSON
];

// Загрузка вопросов из JSON (с fallback)
let questions = defaultQuestions;
try {
  const fs = require('fs');
  const form10 = JSON.parse(fs.readFileSync('form10.json', 'utf8'));
  const form11 = JSON.parse(fs.readFileSync('form11.json', 'utf8'));
  questions = [...form10, ...form11]; // Предполагаем, что это массивы вопросов
} catch (err) {
  console.warn('Файлы form10.json или form11.json не найдены, использую дефолтные вопросы:', err.message);
}

// Глобальный слушатель для poll_answer (теперь работает лучше в serverless)
bot.on('poll_answer', async (answer) => {
  const userId = answer.user.id;
  console.log(`Poll answer from ${userId}:`, answer);

  // Получить состояние из KV или памяти
  let progress = userQuizProgress[userId];
  if (kv) {
    progress = await kv.get(`quiz:${userId}`);
  }

  if (!progress || answer.poll_id !== progress.currentPollId) {
    console.log('Poll ID не совпадает или нет прогресса');
    return;
  }

  // Проверить ответ
  const currentQ = questions[progress.currentQuestion];
  const isCorrect = answer.option_ids[0] === currentQ.correct;

  // Сохранить ответ
  progress.answers.push({ question: progress.currentQuestion, isCorrect });
  progress.currentQuestion++;

  // Обновить в KV или памяти
  if (kv) {
    await kv.set(`quiz:${userId}`, progress);
  } else {
    userQuizProgress[userId] = progress;
  }

  // Следующий вопрос или конец
  if (progress.currentQuestion < questions.length) {
    sendQuiz(userId);
  } else {
    bot.sendMessage(userId, `Викторина закончена! Правильных ответов: ${progress.answers.filter(a => a.isCorrect).length}/${progress.answers.length}`);
    delete userQuizProgress[userId]; // Очистить
    if (kv) await kv.del(`quiz:${userId}`);
  }
});

// Функция отправки викторины
async function sendQuiz(chatId) {
  let progress = userQuizProgress[chatId];
  if (kv) {
    progress = await kv.get(`quiz:${chatId}`);
  }

  if (!progress) {
    progress = { currentQuestion: 0, answers: [] };
  }

  const question = questions[progress.currentQuestion];
  const poll = await bot.sendPoll(chatId, question.question, question.options, {
    type: 'quiz',
    correct_option_id: question.correct,
    is_anonymous: false,
  });

  progress.currentPollId = poll.poll.id;

  // Сохранить
  if (kv) {
    await kv.set(`quiz:${chatId}`, progress);
  } else {
    userQuizProgress[chatId] = progress;
  }
}

// Обработчик /start
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, 'Привет! Начнём викторину?', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Да', callback_data: 'start_quiz' }]]
    }
  });
});

// Обработчик callback_query
bot.on('callback_query', (query) => {
  const chatId = query.message.chat.id;
  if (query.data === 'start_quiz') {
    sendQuiz(chatId);
  }
});

// Экспорт для Vercel (serverless)
module.exports = async (req, res) => {
  if (req.method === 'POST') {
    try {
      console.log('Webhook received:', JSON.stringify(req.body, null, 2));
      await bot.processUpdate(req.body);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Error processing update:', error);
      res.status(500).send('Error');
    }
  } else {
    res.status(405).send('Method not allowed');
  }
};
