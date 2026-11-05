//+------------------------------------------------------------------+
//|                                                      GridBot.mq5 |
//+------------------------------------------------------------------+
#property copyright "TREND AI CRYPTO PRO"
#property link      "https://github.com/elalaouifarouk794-lgtm/trend-ai-crypto-pro"
#property version   "1.00"

input string   InpServerUrl   = "http://localhost:8090/api/mt5-bot"; // Or your deployed server URL
input string   InpSecretToken = "MY_SECRET_KEY_123";
input int      InpTimerSec    = 15; // Send update every 15 seconds

int OnInit()
{
   EventSetTimer(InpTimerSec);
   SendStatusToServer("RUNNING");
   return(INIT_SUCCEEDED);
}

void OnDeinit(const int reason)
{
   EventKillTimer();
   SendStatusToServer("STOPPED");
}

void OnTimer()
{
   SendStatusToServer("RUNNING");
}

void SendStatusToServer(string botState)
{
   string headers = "Content-Type: application/json\r\n";
   char post[], result[];
   string result_headers;
   
   double equity = AccountInfoDouble(ACCOUNT_EQUITY);
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   int positions = PositionsTotal();
   
   string jsonPayload = StringFormat(
      "{\"bot_name\":\"GridBot PRO\",\"status\":\"%s\",\"equity\":%.2f,\"balance\":%.2f,\"open_positions\":%d,\"secret_token\":\"%s\"}",
      botState, equity, balance, positions, InpSecretToken
   );
   
   StringToCharArray(jsonPayload, post, 0, WHOLE_ARRAY, CP_UTF8);
   
   ResetLastError();
   int res = WebRequest("POST", InpServerUrl, headers, 5000, post, result, result_headers);
   
   if(res == -1)
   {
      Print("WebRequest error. Code: ", GetLastError());
   }
   else
   {
      Print("MT5 Status sent successfully to Server!");
   }
}
