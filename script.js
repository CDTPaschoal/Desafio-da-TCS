const express = require('express');
const bodyParser = require('body-parser');
const imaps = require('imap-simple');
const { MongoClient } = require('mongodb');
const xml2js = require('xml2js');
const fs = require('fs');
const path = require('path');


const app = express();
app.use(bodyParser.json());

const mongoUrl = 'mongodb://localhost:imap.hostinger.com';
const dbName = 'emailDocuments';
let db;
app.post('/download.emails',async(req,res))

// Conectar ao MongoDB
MongoClient.connect(mongoUrl, { useNewUrlParser: true, useUnifiedTopology: true }, (err, client) => {
    if (err) throw err;
    db = client.db(dbName);
    console.log("Conectado ao MongoDB");
});

// Rota para obter documentos
app.post('/getDocuments', async (req, res) => {
    const { email, password, host, port } = req.body;

    const config = {
        imap: {
            user: email,
            password: password,
            host: host,
            port: port,
            tls: true,
            authTimeout: 3000
        }
    };

    try {
        const connection = await imaps.connect(config);
        await connection.openBox('INBOX');

        const searchCriteria = ['UNSEEN'];
        const fetchOptions = { bodies: ['HEADER.FIELDS (FROM TO SUBJECT DATE)'], struct: true };

        const messages = await connection.search(searchCriteria, fetchOptions);
        const attachments = [];

        for (const message of messages) {
            const parts = imaps.getParts(message.attributes.struct);
            for (const part of parts) {
                if (part.disposition && part.disposition.type.toUpperCase() === 'ATTACHMENT' && part.params.name.endsWith('.xml')) {
                    const partData = await connection.getPartData(message, part);
                    const content = partData.toString('utf8');
                    const filename = part.params.name;
                    const date = new Date().toISOString();

                    const attachment = { date, filename, contentFile: content };
                    attachments.push(attachment);

                    // Salvar no MongoDB
                    await db.collection('documents').insertOne(attachment);
                }
            }
        }

        res.json(attachments);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao processar emails');
    }
});

// Rota para obter informações do documento
app.get('/getInfoDocument/:filename', async (req, res) => {
    const { filename } = req.params;

    try {
        const document = await db.collection('documents').findOne({ filename });
        if (!document) {
            return res.status(404).send('Documento não encontrado');
        }

        const parser = new xml2js.Parser();
        const result = await parser.parseStringPromise(document.contentFile);

        const info = {
            cNF: result.nfeProc.NFe[0].infNFe[0].$.Id,
            emitCNPJ: result.nfeProc.NFe[0].infNFe[0].emit[0].CNPJ[0],
            emitXNome: result.nfeProc.NFe[0].infNFe[0].emit[0].xNome[0],
            destCNPJ: result.nfeProc.NFe[0].infNFe[0].dest[0].CNPJ[0],
            destXNome: result.nfeProc.NFe[0].infNFe[0].dest[0].xNome[0],
            produtos: result.nfeProc.NFe[0].infNFe[0].det.map(det => ({
                xProd: det.prod[0].xProd[0],
                qCom: det.prod[0].qCom[0]
            }))
        };

        res.json(info);
    } catch (err) {
        console.error(err);
        res.status(500).send('Erro ao processar documento');
    }
});

// Iniciar o servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
