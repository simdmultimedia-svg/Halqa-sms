exports.handler = async (event) => {
  const envKeys = Object.keys(process.env).filter(k => k.includes("TERMII"));
  const hasKey = !!process.env.TERMII_API_KEY;
  const keyLength = hasKey ? process.env.TERMII_API_KEY.length : 0;

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      hasKey,
      keyLength,
      envKeys,
      status: "ok",
      service: "CIC KANO"
    })
  };
};
