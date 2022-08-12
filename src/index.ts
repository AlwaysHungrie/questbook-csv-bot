import axios from 'axios';
import dotenv from 'dotenv';
import { SUBGRAPH_ENDPOINTS } from './subgraphEndpoints';
import { TABLES } from './tables';
import ObjectsToCsv from 'objects-to-csv';
import fs from 'fs';
import TelegramBot from 'node-telegram-bot-api';

const endpoints = SUBGRAPH_ENDPOINTS
const tables = TABLES

dotenv.config();

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, {polling: true});


const getAllGrantsForWorkspaceFromSubgraph = async (workspace: string, endpoint: string, defaultSkip = 0) => {
  const first = 100
  let skip = defaultSkip

  let grants: {id: string, title: string}[] = []
  if (!endpoint) return []
  
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = {
      query: tables['grants'].query,
      variables: {
        first,
        skip,
        workspace,
      }
    };
    try {
      const result = await axios.post(
        endpoint, 
        body
      )
      
      if (result.data?.data?.grants && result.data.data.grants.length > 0) {
        grants = [...grants, ...result.data.data.grants]
        skip += first
      } else {
        break
      }
    } catch (e) {
      break
    }
  }

  // console.log(grants[0].workspace.id)
  return grants
}

const getGrantApplicationsForGrantFromSubgraph = async (grantId: string, endpoint: string, defaultSkip = 0) => {
  const first = 100
  let skip = defaultSkip

  let grantApplications: any[] = []
  if (!endpoint) return []
  
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const body = {
      query: tables['grantApplications'].query,
      variables: {
        first,
        skip,
        grantId
      }
    };
    // console.log('running q', body)
    try {
      const result = await axios.post(
        endpoint, 
        body
      )
      if (result.data?.data?.grantApplications && result.data.data.grantApplications.length > 0) {
        grantApplications = [...grantApplications, ...result.data.data.grantApplications]
        skip += first
      } else {
        break
      }
    } catch (e) {
      break
    }
  }
   //console.log('rec',grantApplications)
  return grantApplications
}

const writeApplicationsToCsv = async (filename: string, applications: any[]) => {
  const data = applications
  let c = [];
  for (let i = 0; i < data.length; i++) {
    const csvFields = new ObjectsToCsv(data[i].fields);
    const csvMilestones = new ObjectsToCsv(data[i].milestones);

    // console.log(csvMilestones.data)
    // await csvFields.toDisk('./test1.csv');

    const transpose = {}

    transpose['applicationId'] = data[i].id;

    csvFields.data.forEach((data: any) => {
      const key = data.id.split('.')[1];
      if (key == 'projectDetails') {
        // console.log(data.values[0].value);
        transpose[key] = `https://ipfs.io/ipfs/${data.values[0].value}`;
      } else {
        transpose[key] = data.values;
      }
    });

    csvMilestones.data.forEach((data: any) => {
      const key = data.id.split('.')[1];
      transpose[`Milestone-${key}-Title`] = data.title;
      transpose[`Milestone-${key}-Amount`] = data.amount;
    });
    
    
    c = [...c, transpose];
  }
  const csv = new ObjectsToCsv(c);
  console.log(csv.data.length);
  await csv.toDisk(`${__dirname}/${filename}.csv`);
}

bot.onText(/\/echo (.+)/, (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message

  const chatId = msg.chat.id;
  const resp = match[1]; // the captured "whatever"

  // send back the matched "whatever" to the chat
  bot.sendMessage(chatId, resp);
});

bot.onText(/\/grants (.+)/, async (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message

  const chatId = msg.chat.id;
  const m = match[1].split(' ')

  const chainId = m[0];
  const daoId = m[1];

  if (!chainId || !daoId || isNaN(Number(chainId)) || !daoId.startsWith('0x')) {
    bot.sendMessage(chatId, 'missing daoId or chainId');
    return
  }

  const endpoint = endpoints.find((endpoint) => endpoint.chainId == Number(chainId))?.endpoint
  if (!endpoint) {
    bot.sendMessage(chatId, 'chainId not supported')
    return
  }

  const grants = await getAllGrantsForWorkspaceFromSubgraph(daoId, endpoint);
  grants.forEach(g => {
    const resp = `${g.title}: ${g.id}`
    bot.sendMessage(chatId, resp);
  })
});

bot.onText(/\/csv (.+)/, async (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message

  const chatId = msg.chat.id;
  const m = match[1].split(' ')

  const chainId = m[0];
  const grantId = m[1];

  if (!chainId || !grantId || isNaN(Number(chainId)) || !grantId.startsWith('0x')) {
    bot.sendMessage(chatId, 'missing daoId or chainId');
    return
  }

  const endpoint = endpoints.find((endpoint) => endpoint.chainId == Number(chainId))?.endpoint
  if (!endpoint) {
    bot.sendMessage(chatId, 'chainId not supported')
    return
  }

  const applications = await getGrantApplicationsForGrantFromSubgraph(grantId, endpoint);

  if (!applications || !applications.length) {
    bot.sendMessage(chatId, 'no applications')
    return
  }

  const today = new Date()
  const filename = `${grantId}-${today.toISOString()}`
  await writeApplicationsToCsv(filename, applications)

  const buffer = fs.readFileSync(`${__dirname}/${filename}.csv`);
  bot.sendDocument(chatId, buffer, {}, {
    filename: `${filename}.csv`,
    contentType: 'text/csv'
  });

  fs.unlinkSync(`${__dirname}/${filename}.csv`)
  return
});
