# 🏛️ Monitor Proposições RR — ALE-RR

Monitora automaticamente a API SAPL da Assembleia Legislativa de Roraima e envia email quando há proposições novas. Roda **4x por dia** via GitHub Actions (8h, 12h, 17h e 21h, horário de Brasília).

---

## Como funciona

1. O GitHub Actions roda o script nos horários configurados
2. O script chama a API pública da ALE-RR (`sapl.al.rr.leg.br/api`)
3. Compara as proposições recebidas com as já registradas no `estado.json`
4. Se há proposições novas → envia email com a lista organizada por tipo
5. Salva o estado atualizado no repositório

---

## Estrutura do repositório

```
monitor-proposicoes-rr/
├── monitor.js
├── package.json
├── estado.json
├── README.md
└── .github/
    └── workflows/
        └── monitor.yml
```

---

## API utilizada

```
URL Base:  https://sapl.al.rr.leg.br
Endpoint:  GET /api/materia/materialegislativa/
Params:    ?ano=2026&page=1&page_size=100&ordering=-id
Sistema:   SAPL Interlegis (open source, sem autenticação)
```

---

## Horários de execução

| Horário BRT | Cron UTC   |
|-------------|------------|
| 08:00       | 0 11 * * * |
| 12:00       | 0 15 * * * |
| 17:00       | 0 20 * * * |
| 21:00       | 0 0 * * *  |

---

## Secrets necessários

| Name              | Valor                                      |
|-------------------|--------------------------------------------|
| `EMAIL_REMETENTE` | Gmail remetente (ex: seuemail@gmail.com)   |
| `EMAIL_SENHA`     | App Password de 16 letras (sem espaços)    |
| `EMAIL_DESTINO`   | Email de destino dos alertas               |

---

## Resetar o estado

Para forçar o reenvio de todas as proposições:

1. Clique em `estado.json` → lápis (editar)
2. Substitua o conteúdo por:
```json
{"proposicoes_vistas":[],"ultima_execucao":""}
```
3. Commit → rode o workflow manualmente em Actions

---

## Problemas comuns

**Erro "Authentication failed"**
→ Verifique se `EMAIL_SENHA` foi colado sem espaços.

**Workflow não aparece em Actions**
→ Confirme que o arquivo está em `.github/workflows/monitor.yml`.

**Log mostra "0 proposições encontradas"**
→ Teste no browser: `https://sapl.al.rr.leg.br/api/materia/materialegislativa/?ano=2026&page=1&page_size=1`

**Tipo aparece como número no email**
→ O campo `__str__` da API tem formato diferente do esperado. Abra o log e ajuste o regex em `extrairTipo()` no `monitor.js`.
