const TelegramBot = require('node-telegram-bot-api');

// загрузка данных тем и вопросов
const form10 = require('../form10.json');
const form11 = require('../form11.json');
const topics = {
  form10: { name: '10 класс', data: form10 },
  form11: { name: '11 класс', data: form11 }
};

const QUIZ_LENGTH = 10;

// экспорт функции для Vercel (serverless)
module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method Not Allowed');
    return;
  }

  try {
    const update = req.body;

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) throw new Error('TELEGRAM_BOT_TOKEN не установлен в окружении');

    // создаём бот без polling и обрабатываем Update напрямую (webhook-style)
    const bot = new TelegramBot(token, { polling: false });

    // Опционально попытаться установить вебхук (если вы задали VERCEL_URL)
    if (process.env.VERCEL_URL) {
      try {
        await bot.setWebHook(`${process.env.VERCEL_URL}/api/bot`);
      } catch (e) {
        // игнорируем, может быть уже установлен или недоступен
      }
    }

    
      const data = await resp.json();
      if (data && data.result !== undefined) {
        try {
          return JSON.parse(data.result);
        } catch {
          return data.result;
        }
      }
      return null;
    }

    

    async function getUserTopics(userId) {
      const data = await redisGet(`quiz:user:${userId}:topics`);
      return Array.isArray(data) ? data : (data ? [data] : []);
    }

    async function setUserTopics(userId, arr) {
      await redisSet(`quiz:user:${userId}:topics`, arr);
    }

    async function getProgress(userId) {
      const p = await redisGet(`quiz:user:${userId}:progress`);
      return p || { answered: 0 };
    }

    async function setProgress(userId, obj) {
      await redisSet(`quiz:user:${userId}:progress`, obj);
    }

    async function getMark(userId) {
      const m = await redisGet(`quiz:user:${userId}:mark`);
      return m || { answered: 0 };
    }

    async function setMark(userId, obj) {
      await redisSet(`quiz:user:${userId}:mark`, obj);
    }

    async function getQuestionsByTopics(userId) {
      const selectedTopics = await getUserTopics(userId);
      const keys = selectedTopics && selectedTopics.length ? selectedTopics : Object.keys(topics);
      let all = [];
      for (const tKey of keys) {
        const arr = topics[tKey]?.data;
        if (Array.isArray(arr)) all = all.concat(arr);
      }
      return all;
    }

    async function getRandomQuestion(userId) {
      const questions = await getQuestionsByTopics(userId);
      if (!questions || questions.length === 0) return null;
      const idx = Math.floor(Math.random() * questions.length);
      return questions[idx];
    }

    async function sendQuiz(chatId, userId) {
      let progressObj = await getProgress(userId);
      if (!progressObj) progressObj = { answered: 0 };
      let markObj = await getMark(userId);
      if (!markObj) markObj = { answered: 0 };

      const questionData = await getRandomQuestion(userId);
      if (!questionData) {
        await bot.sendMessage(chatId, 'Нет доступных вопросов по выбранным темам.');
        return;
      }

      bot
        .sendPoll(
          chatId,
          questionData.question,
          questionData.options,
          {
            type: 'quiz',
            correct_option_id: questionData.correct_option_id,
            is_anonymous: false
          }
        )
        .then(async (pollMessage) => {
          const pollId = pollMessage.poll.id;

          async function pollAnswerHandler(answer) {
            if (answer.poll_id === pollId) {
              const selectedOption = answer.option_ids[0];
              const isCorrect = selectedOption === questionData.correct_option_id;

              if (!isCorrect) {
                const feedback =
                  (questionData.explanation ? questionData.explanation + '\n\n' : '');
                await bot.sendMessage(chatId, feedback);
              } else {
                const m = await getMark(userId);
                m.answered += 1;
                await setMark(userId, m);
              }

              // обновляем прогресс
              let p = await getProgress(userId);
              p.answered += 1;
              await setProgress(userId, p);

              if (p.answered < QUIZ_LENGTH) {
                await sendQuiz(chatId, userId);
              } else {
                const score = (await getMark(userId)).answered;
                await bot.sendMessage(chatId, `Викторина завершена! Ваша оценка ${score}`);
                // сброс состояния
                await setProgress(userId, { answered: 0 });
                await setMark(userId, { answered: 0 });
              }

              bot.removeListener('poll_answer', pollAnswerHandler);
            }
          }

          bot.on('poll_answer', pollAnswerHandler);
        })
        .catch((err) => {
          console.error('Ошибка при отправке опроса:', err);
          bot.sendMessage(chatId, 'Произошла ошибка при отправке викторины. Попробуйте позже.');
        });
    }

    // Команды и обработчики
    bot.onText(/\/start/, (msg) => {
      bot.sendMessage(
        msg.chat.id,
        'Привет! Напиши /quiz, чтобы начать викторину. Для выбора тем используй /settopic.'
      );
    });

    bot.onText(/\/quiz/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;
      // инициализация прогресса
      setProgress(userId, { answered: 0 });
      setMark(userId, { answered: 0 });
      sendQuiz(chatId, userId);
    });

    bot.onText(/\/settopic/, (msg) => {
      const chatId = msg.chat.id;
      const userId = msg.from.id;

      (async () => {
        const userTs = await getUserTopics(userId);
        // кнопки тем
        const keyboard = Object.keys(topics).map((tk) => [
          {
            text: topics[tk].name + (userTs.includes(tk) ? ' ✅' : ''),
            callback_data: tk
          }
        ]);
        const inlineKeyboard = { reply_markup: { inline_keyboard: keyboard } };
        await bot.sendMessage(chatId, 'Выберите темы:', inlineKeyboard);
      })();
    });

    bot.on('callback_query', (callbackQuery) => {
      const message = callbackQuery.message;
      const userId = callbackQuery.from.id;
      const topicKey = callbackQuery.data;

      (async () => {
        let current = await getUserTopics(userId);
        if (!Array.isArray(current)) current = [];

        if (current.includes(topicKey)) {
          current = current.filter((t) => t !== topicKey);
        } else {
          current.push(topicKey);
        }

        await setUserTopics(userId, current);

        const keyboard = Object.keys(topics).map((tk) => [
          {
            text: topics[tk].name + (current.includes(tk) ? ' ✅' : ''),
            callback_data: tk
          }
        ]);
        const inlineKeyboard = { reply_markup: { inline_keyboard: keyboard } };
        await bot.editMessageText('Выберите темы:', {
          chat_id: message.chat.id,
          message_id: message.message_id,
          reply_markup: inlineKeyboard.reply_markup
        });
      })();
    });

    // Обработчик самого обновления Telegram
    await bot.processUpdate(update);

    res.status(200).send('ok');
  } catch (err) {
    console.error('Ошибка обработки обновления Telegram:', err);
    res.status(500).send('Internal Server Error');
  }
};
