import { openai } from "@ai-sdk/openai";
import { streamText, UIMessage, convertToModelMessages } from "ai";
import { randomUUID } from "crypto";

export async function POST(req: Request) {
  const requestId = randomUUID();
  try {
    const headersObj: Record<string, string | null> = {};
    req.headers.forEach((v, k) => {
      // mask sensitive headers like authorization
      if (k.toLowerCase() === "authorization" || k.toLowerCase() === "cookie") {
        headersObj[k] = v ? "[REDACTED]" : null;
      } else {
        headersObj[k] = v;
      }
    });

    console.log(`[${requestId}] Incoming request headers:`, headersObj);

    const contentType = req.headers.get("content-type");
    console.log(`[${requestId}] Content-Type:`, contentType);

    const bodyText = await req.text();
    console.log(`[${requestId}] Raw body length:`, bodyText.length);

    let body: any;
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch (parseErr) {
      console.error(`[${requestId}] Failed to parse JSON body:`, parseErr);
      return new Response(
        JSON.stringify({ error: "Invalid JSON body", requestId }),
        { status: 400, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } }
      );
    }

    console.log(`[${requestId}] API received body keys:`, Object.keys(body));

    const { messages }: { messages: UIMessage[] } = body;
    
    if (!messages || !Array.isArray(messages)) {
      console.error(`[${requestId}] Invalid messages:`, messages);
      return new Response(
        JSON.stringify({ error: "Messages array is required", requestId }),
        { status: 400, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } }
      );
    }
    
    if (messages.length === 0) {
      console.error(`[${requestId}] Empty messages array`);
      return new Response(
        JSON.stringify({ error: "Messages array cannot be empty", requestId }),
        { status: 400, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } }
      );
    }
    
    console.log(`[${requestId}] Processing messages:`, messages.length);
    console.log(`[${requestId}] Message sample:`, messages[0]);

    // Try to convert messages for the model (but don't fail the request if conversion breaks)
    let converted: any = null;
    try {
      converted = convertToModelMessages(messages as any);
      console.log(`[${requestId}] Converted messages sample:`, Array.isArray(converted) ? converted[0] : converted);
    } catch (convErr) {
      console.warn(`[${requestId}] convertToModelMessages failed:`, convErr);
    }

    console.log(`[${requestId}] Starting streamText with model gpt-4o-mini`);
    const result = streamText({
      model: openai("gpt-4o-mini"),
      messages: (converted ?? messages) as any,
    });

    // When the stream response is created, log and include the request id header
    const res = result.toUIMessageStreamResponse();
    res.headers.set("X-Request-Id", requestId);
    console.log(`[${requestId}] Streaming response prepared`);
    return res;
  } catch (error: any) {
    console.error(`[${requestId}] API Error:`, error);
    return new Response(
      JSON.stringify({ error: error.message || "Internal server error", requestId }),
      { status: 500, headers: { "Content-Type": "application/json", "X-Request-Id": requestId } }
    );
  }
}
