// Durable Object for future session storage or rate limiting
export class SessionStorage {
  state: DurableObjectState
  
  constructor(state: DurableObjectState, env: any) {
    this.state = state
  }

  async fetch(request: Request) {
    let count = (await this.state.storage.get<number>("count")) || 0
    count++
    await this.state.storage.put("count", count)
    return new Response(count.toString())
  }
}
