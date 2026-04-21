---
name: vapi-calls
version: 0.1.0
description:
  Make outbound phone calls via Vapi voice AI. Use when the agent needs to call someone
  on the phone for any reason (reminders, notifications, requests to businesses, or any
  task that benefits from a real voice conversation). Requires VAPI_API_KEY, a
  provisioned phone number, and an assistant configured in Vapi.
description:
  Make outbound phone calls via Vapi voice AI. Use when the agent needs to call someone
  on the phone — reminders, notifications, requests to businesses, or any task that
  benefits from a real voice conversation. Requires VAPI_API_KEY, a provisioned phone
  number, and an assistant configured in Vapi.
---

# Vapi Voice Calls

Make real outbound phone calls through Vapi's voice AI platform.

## Prerequisites

Check that these are set in your environment:

- `VAPI_API_KEY`
- `VAPI_ASSISTANT_ID`
- `VAPI_PHONE_NUMBER_ID`

If any are missing, read [references/setup.md](references/setup.md) and complete
first-time setup before proceeding.

## Making a Call

Use the Vapi `POST /call` endpoint with:

- `phoneNumberId` and `assistantId` from your config
- `customer.number` — the phone number to call (E.164 format)
- `assistantOverrides.model.systemPrompt` — the full system prompt including
  task-specific instructions for this call
- `assistantOverrides.firstMessage` — a contextual opening line for this specific call

The base assistant defines voice, transcriber, and personality defaults. The override
injects what THIS call is about.

### System Prompt Structure for Each Call

1. The base prompt (heart-centered foundation + agent personality + "You are on a live
   phone call")
2. A `TASK:` section with specific instructions for this call

Everything the voice agent needs to know goes in the override. The voice agent has no
memory between calls.

### After the Call

Poll `GET /call/{id}` to check status and `endedReason`. Key values:

- `assistant-ended-call` — completed normally
- `customer-did-not-answer` — no pickup, consider retrying or texting first
- `pipeline-error-*` — voice provider issue, check configuration

## Notes

- Vapi built-in voices are free. ElevenLabs voices require a paid ElevenLabs plan.
- Cost is ~$0.05-0.07/min, pay-as-you-go.
- Template variables (`{{var}}`) can be used in prompts, resolved from call metadata.
Make real phone calls through Vapi's voice AI platform.

## Prerequisites

- `VAPI_API_KEY` in gateway env vars
- A Vapi assistant ID (created per-agent with personality + heart-centered system
  prompt)
- A Vapi phone number ID (provisioned per-agent, free US numbers available)

## Setup (One-Time Per Agent)

### 1. Create Account

Sign up at https://dashboard.vapi.ai with Google. Each fleet account uses one shared
org, or agents can have separate orgs.

### 2. Add API Key to Gateway

```bash
openclaw config patch '{"env":{"vars":{"VAPI_API_KEY":"your-key-here"}}}'
```

### 3. Provision a Phone Number

```bash
curl -s -X POST "https://api.vapi.ai/phone-number" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"provider":"vapi","name":"AgentName","numberDesiredAreaCode":"657"}' | jq .
```

- Free US numbers (up to 10 per account)
- Must specify an area code. If unavailable, the API suggests alternatives.
- Number starts in `activating` status. Poll until `active` (~1-2 minutes).
- **Do NOT omit the area code** — numbers created without one lack PSTN transport and
  silently fail.

### 4. Create an Assistant

```bash
curl -s -X POST "https://api.vapi.ai/assistant" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "AgentName",
    "model": {
      "provider": "openai",
      "model": "gpt-4o",
      "systemPrompt": "YOUR BASE SYSTEM PROMPT HERE"
    },
    "voice": {"provider": "vapi", "voiceId": "Leah"},
    "transcriber": {"provider": "deepgram", "model": "nova-2", "language": "en"},
    "firstMessageMode": "assistant-speaks-first",
    "firstMessage": "Hello, this is AgentName."
  }' | jq .
```

#### System Prompt Design

The base system prompt should be minimal and generic:

1. Heart-centered foundation (from `heart-centered-prompts` terse version)
2. Agent personality (2-3 sentences)
3. "You are on a live phone call. Your task instructions will tell you who you are
   calling, why, and what to accomplish. Follow them."

All call-specific instructions go in `assistantOverrides` at call time. The assistant is
a warm, capable voice ready for any task.

#### Available Vapi Voices (Free, Built-In)

Female: Clara, Kylie, Lily, Savannah, Hana, Neha, Paige, Emma, Naina, Leah, Tara, Jess,
Mia, Zoe Male: Godfrey, Elliot, Rohan, Cole, Harry, Spencer, Nico, Kai, Sagar, Neil,
Leo, Dan, Zac

Voice tags (where known):

- **Leah**: Warm, Gentle
- **Mia**: Professional, Articulate
- **Tara**: Conversational, Clear
- **Jess**: Energetic, Youthful
- **Zoe**: Calm, Soothing

ElevenLabs voices also available if you add credentials via `POST /credential` with
`provider: "11labs"`. Requires a paid ElevenLabs plan for real-time streaming.

## Making a Call

```bash
curl -s -X POST "https://api.vapi.ai/call" \
  -H "Authorization: Bearer $VAPI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumberId": "YOUR_PHONE_NUMBER_ID",
    "assistantId": "YOUR_ASSISTANT_ID",
    "assistantOverrides": {
      "model": {
        "provider": "openai",
        "model": "gpt-4o",
        "systemPrompt": "BASE PROMPT + TASK INSTRUCTIONS"
      },
      "firstMessage": "Context-specific greeting"
    },
    "customer": {"number": "+1XXXXXXXXXX"}
  }' | jq '{id: .id, status: .status}'
```

### Key Patterns

**Dynamic per-call instructions via `assistantOverrides`:**

- Override `systemPrompt` to inject the specific task
- Override `firstMessage` for a contextual greeting
- The base assistant defines voice, transcriber, and defaults
- The override defines what THIS call is about

**Template variables:** Use `{{variable}}` in prompts, resolved from call metadata.

**Check call status:**

```bash
curl -s "https://api.vapi.ai/call/CALL_ID" \
  -H "Authorization: Bearer $VAPI_API_KEY" | jq '{status, endedReason}'
```

### Common `endedReason` Values

| Reason                                         | Meaning                 | Fix                                            |
| ---------------------------------------------- | ----------------------- | ---------------------------------------------- |
| `call.start.error-get-transport`               | Phone number lacks PSTN | Provision with area code                       |
| `pipeline-error-eleven-labs-blocked-free-plan` | ElevenLabs free tier    | Use Vapi built-in voices or upgrade ElevenLabs |
| `customer-did-not-answer`                      | No pickup               | Retry or text first                            |
| `assistant-ended-call`                         | Call completed normally | Success                                        |

## Fleet Deployment Pattern

One Vapi account, one API key. Each agent gets:

1. Its own assistant (personality, voice, name)
2. Its own phone number
3. Shared billing under the org

Store per-agent values in agent config or TOOLS.md:

```
VAPI_ASSISTANT_ID=xxx
VAPI_PHONE_NUMBER_ID=xxx
VAPI_PHONE_NUMBER=+1XXXXXXXXXX
```

## Cost

- Vapi built-in voices: ~$0.05-0.07/min
- Pay-as-you-go, no subscription
- 10 free US phone numbers per account
- $10 starting credits on new accounts
