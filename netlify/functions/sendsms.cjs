exports.handler = async (event) => {
  try {
    if (!process.env.TERMII_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "TERMII_API_KEY is not set in the environment." }) };
    }
    
    const { to, message } = JSON.parse(event.body);

    const response = await fetch("https://api.ng.termii.com/api/sms/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: process.env.TERMII_API_KEY,
        to: to,
        from: "CIC KANO",
        sms: message,
        type: "plain",
        channel: "generic"
      })
    });

    const data = await response.json();
    return { statusCode: 200, body: JSON.stringify(data) };
  } catch (error) {
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
