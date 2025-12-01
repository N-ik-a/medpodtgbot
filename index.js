const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

// Получайте токен и URL из переменных окружения
const TOKEN = process.env.TOKEN; // В Vercel задайте TOKEN
const WEBHOOK_URL = process.env.WEBHOOK_URL; // В Vercel задайте WEBHOOK_URL, например: https://your-vercel-domain.vercel.app

const bot = new TelegramBot(TOKEN);
const app = express();
app.use(express.json());

// Временное хранилище данных (замените на внешнее хранилище для продакшена)
const userTopics = {};
const userQuizProgress = {};
const userQuizMark = {};

const topics = {
  math: { name: '10 класс', file: 'form10.json' },
  english: { name: '11 класс', file: 'form11.json' }
};

const QUIZ_LENGTH = 10;

// Функция для получения вопросов по выбранным темам
function getQuestionsByTopics(userId) {
  const selectedTopics = userTopics[userId] || Object.keys(topics);
  let allQuestions = [];
  selectedTopics.forEach(topic => {
    try {
      const questions = JSON.parse(fs.readFileSync(topics[topic].file, 'utf8'));
      allQuestions = allQuestions.concat(questions);
    } catch (error) {
      console.error(`Ошибка при чтении файла ${topics[topic].file}:`, error);
    }
  });
  return allQuestions;
}

// Получить случайный вопрос
function getRandomQuestion(userId) {
  const questions = getQuestionsByTopics(userId);
  if (questions.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * questions.length);
  return questions[randomIndex];
}

// Отправка викторины
async function sendQuiz(chatId, userId) {
  if (!userQuizProgress[userId]) {
    userQuizProgress[userId] = { answered: 0 };
  }
  if (!userQuizMark[userId]) {
    userQuizMark[userId] = { answered: 0 };
  }

  const questionData = getRandomQuestion(userId);
  if (!questionData) {
    await bot.sendMessage(chatId, "Нет доступных вопросов по выбранным темам.");
    return;
  }

  try {
    const pollMessage = await bot.sendPoll(chatId, questionData.question, questionData.options, {
      type: 'quiz',
      correct_option_id: questionData.correct_option_id,
      is_anonymous: false
    });
    const pollId = pollMessage.poll.id;

    const pollAnswerHandler = (answer) => {
      if (answer.poll_id === pollId) {
        const selectedOption = answer.option_ids[0];
        const isCorrect = selectedOption === questionData.correct_option_id;

        if (!isCorrect) {
          bot.sendMessage(chatId, questionData.explanation + '\n\n');
        } else {
          userQuizMark[userId].answered++;
        }

        userQuizProgress[userId].answered++;

        if (userQuizProgress[userId].answered < QUIZ_LENGTH) {
          sendQuiz(chatId, userId);
        } else {
          const correctAnswers = userQuizMark[userId].answered;
          bot.sendMessage(chatId, `Викторина завершена! Ваша оценка ${correctAnswers}`);
          delete userQuizProgress[userId];
          delete userQuizMark[userId];
        }
        bot.removeListener('poll_answer', pollAnswerHandler);
      }
    };

    bot.on('poll_answer', pollAnswerHandler);
  } catch (error) {
    console.error('Ошибка при отправке опроса:', error);
    bot.sendMessage(chatId, 'Произошла ошибка при отправке викторины. Попробуйте позже.');
  }
}

// Обработка команд
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  if (msg.text === '/start') {
    bot.sendMessage(chatId, 'Привет! Напиши /quiz, чтобы начать викторину. Для выбора тем используй /settopic.');
  } else if (msg.text === '/quiz') {
    const userId = msg.from.id;
    userQuizProgress[userId] = { answered: 0 };
    userQuizMark[userId] = { answered: 0 };
    sendQuiz(chatId, userId);
  } else if (msg.text === '/settopic') {
    // Отправляем inline клавиатуру для выбора тем
    const keyboard = Object.keys(topics).map(topicKey => ([
      {
        text: topics[topicKey].name + (userTopics[msg.from.id] && userTopics[msg.from.id].includes(topicKey) ? ' ✅' : ''),
        callback_data: topicKey
      }
    ]));
    bot.sendMessage(chatId, 'Выберите темы:', {
      reply_markup: { inline_keyboard: keyboard }
    });
  }
});

// Обработка callback-кнопок
bot.on('callback_query', (callbackQuery) => {
  const message = callbackQuery.message;
  const userId = callbackQuery.from.id;
  const topicKey = callbackQuery.data;

  if (!userTopics[userId]) {
    userTopics[userId] = [];
  }

  if (userTopics[userId].includes(topicKey)) {
    userTopics[userId] = userTopics[userId].filter(t => t !== topicKey);
  } else {
    userTopics[userId].push(topicKey);
  }

  // Обновление клавиатуры
  const keyboard = Object.keys(topics).map(topicKey => ([
    {
      text: topics[topicKey].name + (userTopics[userId].includes(topicKey) ? ' ✅' : ''),
      callback_data: topicKey
    }
  ]));

  bot.editMessageText('Выберите темы:', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    reply_markup: { inline_keyboard: keyboard }
  });
});

// Настройка webhook
app.post(`/${TOKEN}`, (req, res) => {
  bot.processUpdate(req.body);
  res.sendStatus(200);
});

// Запуск сервера и установка webhook
app.listen(3000, async () => {
  console.log('Server started');
  try {
    await bot.setWebHook(`${WEBHOOK_URL}/${TOKEN}`);
    console.log('Webhook установлен');
  } catch (err) {
    console.error('Ошибка установки webhook:', err);
  }
});
