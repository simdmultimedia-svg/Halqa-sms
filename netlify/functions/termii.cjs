exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body);
    const action = body.action || "balance";
    const apiKey = body.apiKey || process.env.TERMII_API_KEY;

    if (!apiKey) {
      return { statusCode: 500, body: JSON.stringify({ error: "Termii API Key is not configured." }) };
    }

    if (action === "balance" || action === "checkBalance") {
      const response = await fetch("https://api.ng.termii.com/api/get-balance?api_key=" + apiKey, {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      });
      const data = await response.json();
      return { statusCode: 200, body: JSON.stringify(data) };
    }

    return { statusCode: 400, body: JSON.stringify({ error: "Unknown action" }) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
