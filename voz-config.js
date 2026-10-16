// Servidor de retransmissão da voz (TURN).
// Sem ele, a voz entre dois celulares no 4G/5G quase nunca conecta.
//
// Metered (plano grátis): no painel, abra TURN Server, clique em
// "Add Credential" e depois em "Instructions". Copie o bloco iceServers
// e cole abaixo, no lugar dos colchetes vazios. Fica assim:
//
//   window.TURN_SERVERS = [
//     { urls: "stun:stun.relay.metered.ca:80" },
//     { urls: "turn:standard.relay.metered.ca:80", username: "XXXX", credential: "YYYY" },
//     { urls: "turn:standard.relay.metered.ca:443", username: "XXXX", credential: "YYYY" },
//     { urls: "turns:standard.relay.metered.ca:443?transport=tcp", username: "XXXX", credential: "YYYY" },
//   ];
//
// Deixe vazio para usar só a conexão direta (funciona no mesmo Wi-Fi).
window.TURN_SERVERS = [
  { urls: "stun:stun.relay.metered.ca:80" },
  { urls: "turn:standard.relay.metered.ca:80", username: "9fd6f6eaea36e9e38e3c17d9", credential: "85lRJZZEIeaKR3mD" },
  { urls: "turn:standard.relay.metered.ca:80?transport=tcp", username: "9fd6f6eaea36e9e38e3c17d9", credential: "85lRJZZEIeaKR3mD" },
  { urls: "turn:standard.relay.metered.ca:443", username: "9fd6f6eaea36e9e38e3c17d9", credential: "85lRJZZEIeaKR3mD" },
  { urls: "turns:standard.relay.metered.ca:443?transport=tcp", username: "9fd6f6eaea36e9e38e3c17d9", credential: "85lRJZZEIeaKR3mD" },
];

// Opcional, só se o seu plano mostrar um link "Credentials API" com apiKey:
window.TURN_CREDENTIALS_URL = "";
