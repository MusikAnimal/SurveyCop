const apiUrl = 'https://meta.wikimedia.org/w/api.php';

// Dependencies.
const EventSource = require('eventsource');
const url = 'https://stream.wikimedia.org/v2/stream/recentchange';
const argv = require('minimist')(process.argv.slice(2));
const MWBot = require('mwbot');
const colors = require('colors');

// Load credentials from config.
const credentials = require('./credentials');

let botConfig;
let bot = new MWBot();

bot.setGlobalRequestOptions({
    headers: {
        'User-Agent': 'Community Tech bot on Node.js',
        timeout: 8000
    },
});

// Connect to API.
console.log(`Connecting to the API`);

bot.loginGetEditToken({
    apiUrl: apiUrl,
    username: credentials.username,
    password: credentials.password
}).then(() => {
    console.log('API connection successful'.green);
    console.log('Loading config...'.gray);

    getContent('User:Community Tech bot/WishlistSurvey/config').then(content => {
        botConfig = JSON.parse(content);
        console.log('Bot configuration loaded.'.green);
        watchSurvey();
    }).catch((err) => {
        console.log(`Failed to load config! Error:\n\t${err}`.red);
    });
}).catch((err) => {
    console.log(`Failed to connect to the API! Error:\n\t${err}`.red);
});

function watchSurvey()
{
    console.log(`Connecting to EventStreams at ${url}`.gray);
    const eventSource = new EventSource(url);

    eventSource.onopen = event => {
        console.log('--- Opened connection and watching for changes...'.green);
    };

    eventSource.onerror = event => {
        console.error('--- Encountered error'.red, event);
    };

    eventSource.onmessage = event => {
        const data = JSON.parse(event.data);

        if (data.wiki === 'metawiki' && data.title.startsWith(`${botConfig.survey_root}/`)) {
            processEvent(data);
        }
    };
}

function processEvent(data)
{
    if (data.user === 'Community Tech bot') {
        return;
    }

    if (data.title.split('/').length <= 2) {
        console.log(`Non-proposal page edited, ignoring.`.yellow);
        return;
    }

    const [fullTitle, category, proposal] = getCategoryAndProposal(data.title);

    const validCategory = botConfig.categories.includes(category);

    if (!validCategory) {
        return console.log(`Edit in invalid category -- ${fullTitle}`.yellow);
    }

    if (data.type === 'new') {
        console.log(`New proposal added (${category}): `.green + proposal.blue);
        transcludeProposal(category, proposal);
    } else if (data.type === 'log' && data.log_type === 'move') {
        const [newFullTitle, newCategory, newProposal] = getCategoryAndProposal(data.log_params.target);
        console.log('Proposal moved: '.magenta + `${proposal.blue} (${category.blue}) ` +
            `~> ${newProposal.blue} (${newCategory.blue})`);

        const editSummary = `"${proposal}" moved to [[${newFullTitle}|${newCategory}/${newProposal}]]`;

        // Remove from old category.
        untranscludeProposal(category, proposal, editSummary).then(() => {
            // Add to new one.
            transcludeProposal(newCategory, proposal);
        });
    } else if (data.type === 'log' && data.log_type === 'delete') {
        console.log(`Proposal ${proposal} (${category}) deleted. Removing transclusion`.yellow);
        untranscludeProposal(
            category,
            proposal,
            `Proposal "[[${fullTitle}|${proposal}]]" was deleted.`
        );
    }
}

function getCategoryAndProposal(pageTitle)
{
    return /.*?\/(.*?)\/(.*?)$/.exec(pageTitle);
}

function untranscludeProposal(category, proposal, editSummary)
{
    const categoryPath = `${botConfig.survey_root}/${category}`;
    const fullTitle = `${categoryPath}/${proposal}`;

    return getContent(categoryPath).then(oldCategoryContent => {
        bot.update(
            categoryPath,
            oldCategoryContent.replace(`\n{{:${fullTitle}}}`, ''),
            editSummary
        );
    });
}

function transcludeProposal(category, proposal)
{
    const categoryPage = `${botConfig.survey_root}/${category}`;
    console.log('Transcluding proposal...'.gray);

    getContent(categoryPage).then(content => {
        const newRow = `{{:${categoryPage}/${proposal}}}`;
        if (content.includes(newRow)) {
            return console.log('-- already transcluded'.gray);
        }
        content = content.trim() + `\n{{:${categoryPage}/${proposal}}}`;

        bot.update(categoryPage, content, `Transcluding proposal "[[${categoryPage}/${proposal}|${proposal}]]"`);
    });
}

function getContent(pageTitle)
{
    return bot.read(pageTitle).then(response => {
        const pageId = Object.keys(response.query.pages);
        return response.query.pages[pageId].revisions[0]['*'];
    }).catch((err) => {
        console.log(`Failed to read page ${pageTitle}! Error:\n\t${err}`.red);
    });
}
