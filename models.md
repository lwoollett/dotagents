# Model Setup

- **OMP** -- Work shit, uses vllm hosted internally, free tokens are free.
- **OMP-Home** -- Home shit, uses z.ai
- **OpenCode** -- uses z.ai cause pre-work ban.


---

# Why these models

Generally, you want to use the fastest model, that can get the task done for the cheapest.
I pay for a z.ai subscription, so by girl math, it's free.

Model, use

GLM-5.3: Planning, normal dev work. Stable, awesome workhorse. Sits somewhere around Opus 4.6+ intelligence, and just does the jobs it's asked to do.
GLM-5.3-Flash: Multimodal. Used for looking at images, and generating text fast. My plan allows me to use it at a max of 50 concurrent, and I normally do ~5. Great for a "commit" or "task" or "multimodal looker" agent. Not normally used as the main agent, but always my task one.
Opus 5: When I want a detailed plan or second opinion. Also used as main planner on work hardware, as z.ai is banned.
Opus 4.6: When I don't need such a big plan on work hardware.
GPT 5.6 Sol: Programming monster, GLM-5.3 replacement on work hardware.
GPT 5.6 Terra / Luna: GLM-5.3-Flash replacement. Terra is also good at programming when Sol isn't needed.

Others:
Local VLLM: Currently using Qwen3.8-Flash-Next on the GB10 as a programming & vision model. It's quite good.
Local VLLM: Also using our trained JADE model as a general programming model; token generation speed is insane, and it's a very good programmer.

Google: Gemini 3.7-flash is a really good design model; I use it quite often with Impeccable as a designer.
