const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');

const token = '8453905301:AAFr0M4FEO-bxnW7iKRVGgTQlUGmuN8QsZA';
if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не установлен');
}
const bot = new TelegramBot(token); // Убрали polling, добавили токен из env

const topics = {
    form10: { name: '10 класс', file: 'form10.json' },
    form11: { name: '11 класс', file: 'form11.json' }
};

let userTopics = {};
const QUIZ_LENGTH = 10;
let userQuizProgress = {};
let userQuizMark = {};

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

function getRandomQuestion(userId) {
    const questions = getQuestionsByTopics(userId);
    if (questions.length === 0) {
        return null;
    }
    const randomIndex = Math.floor(Math.random() * questions.length);
    return questions[randomIndex];
}

function sendQuiz(chatId, userId) {
    if (!userQuizProgress[userId]) {
        userQuizProgress[userId] = { answered: 0 };
    }
    if (!userQuizMark[userId]) {
        userQuizMark[userId] = { correct: 0 }; // Исправлено: correct вместо answered
    }

    const questionData = getRandomQuestion(userId);

    if (!questionData) {
        bot.sendMessage(chatId, "Нет доступных вопросов по выбранным темам.");
        return;
    }

    bot.sendPoll(
        chatId,
        questionData.question,
        questionData.options,
        {
            type: 'quiz',
            correct_option_id: questionData.correct_option_id,
            is_anonymous: false
        }
    ).then(pollMessage => {
        const pollId = pollMessage.poll.id;

        function pollAnswerHandler(answer) {
            if (answer.poll_id === pollId) {
                const selectedOption = answer.option_ids[0];
                const isCorrect = selectedOption === questionData.correct_option_id;

                if (isCorrect) {
                    userQuizMark[userId].correct++; // Считаем только правильные
                } else {
                    // Отправляем объяснение при неправильном ответе
                    bot.sendMessage(chatId, `Неправильно! ${questionData.explanation}`);
                }

                userQuizProgress[userId].answered++;

                if (userQuizProgress[userId].answered < QUIZ_LENGTH) {
                    sendQuiz(chatId, userId);
                } else {
                    const correctAnswers = userQuizMark[userId].correct;
                    bot.sendMessage(chatId, `Викторина завершена! Ваша оценка: ${correctAnswers}/${QUIZ_LENGTH}`);
                    delete userQuizProgress[userId];
                    delete userQuizMark[userId];
                }
                bot.removeListener('poll_answer', pollAnswerHandler);
            }
        }
        bot.on('poll_answer', pollAnswerHandler);
    }).catch(error => {
        console.error("Ошибка при отправке опроса:", error);
        bot.sendMessage(chatId, "Произошла ошибка при отправке викторины. Попробуйте позже.");
    });
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, 'Привет! Напиши /quiz, чтобы начать викторину. Для выбора тем используй /settopic.');
});

bot.onText(/\/quiz/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    userQuizProgress[userId] = { answered: 0 };
    userQuizMark[userId] = { correct: 0 };
    sendQuiz(chatId, userId);
});


// Обработчик команды /settopic
bot.onText(/\/settopic/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;

    const keyboard = Object.keys(topics).map(topicKey => ([
        {
            text: topics[topicKey].name + (userTopics[userId] && userTopics[userId].includes(topicKey) ? ' ✅' : ''),
            callback_data: topicKey
        }
    ]));

    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: keyboard
        }
    };

    bot.sendMessage(chatId, "Выберите темы:", inlineKeyboard);
    bot.sendMessage(chatId, "Для начала викторины нажмите /quiz");
});

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

    const keyboard = Object.keys(topics).map(key => ([
        {
            text: topics[key].name + (userTopics[userId].includes(key) ? ' ✅' : ''),
            callback_data: key
        }
    ]));

    const inlineKeyboard = {
        reply_markup: {
            inline_keyboard: keyboard
        }
    };

    bot.editMessageText("Выберите темы:", {
        chat_id: message.chat.id,
        message_id: message.message_id,
        reply_markup: inlineKeyboard.reply_markup
    });
});


console.log('Бот готов к работе с webhook.');

// Экспорт для Vercel (serverless-функция)
module.exports = (req, res) => {
    if (req.method === 'POST') {
        bot.processUpdate(req.body);
        res.status(200).end();
    } else {
        res.status(405).end();
    }
};
