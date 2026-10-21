//+------------------------------------------------------------------+
//| RobotOfficeReporter.mq5                                           |
//| Envia o estado dos robôs (por magic number ou por conta) ao        |
//| agregador do escritório virtual. Não opera: só lê e reporta.       |
//+------------------------------------------------------------------+
#property copyright "RobotTrader"
#property version   "1.00"
#property description "Reporta posições, P&L aberto/fechado e operações ao escritório virtual."

input string ServerUrl     = "http://127.0.0.1:8787/report"; // URL do agregador (libere em Ferramentas > Opções > Expert Advisors)
input string Token         = "";                              // mesmo valor de ROBOT_OFFICE_TOKEN, se usar
input string RobotId       = "PA_01";                         // robô desta conta (usado quando RobotMap está vazio)
input string RobotMap      = "";                              // vários robôs na conta: "1001=PA_01;1002=PA_02" (magic=id)
input int    ReportSeconds = 5;                               // intervalo entre relatórios
input bool   OnlyToday     = true;                            // P&L fechado só do dia (horário do servidor)

#define MAX_ROBOTS 32
#define MAX_TRADES 12

struct TradeRec
  {
   long   ts;      // epoch UTC (segundos)
   string symbol;
   string side;
   string setup;
   double pnl;
  };

struct RobotRec
  {
   string   id;
   long     magic;      // -1 = todas as posições da conta
   int      positions;
   double   openPnl;
   double   closedPnl;
   string   symbol;
   string   side;
   string   setup;
   int      ntr;
   TradeRec tr[MAX_TRADES];
  };

RobotRec g_robots[MAX_ROBOTS];
int      g_n = 0;
datetime g_lastWarn = 0;

//--- helpers ------------------------------------------------------------
string Esc(string s)
  {
   StringReplace(s, "\\", "\\\\");
   StringReplace(s, "\"", "\\\"");
   StringReplace(s, "\r", " ");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\t", " ");
   return s;
  }

string Num(double v) { return DoubleToString(v, 2); }

void AddRobot(string id, long magic)
  {
   if(g_n >= MAX_ROBOTS)
      return;
   g_robots[g_n].id = id;
   g_robots[g_n].magic = magic;
   g_n++;
  }

void ParseMap()
  {
   g_n = 0;
   if(StringLen(RobotMap) == 0)
     {
      AddRobot(RobotId, -1);
      return;
     }
   string parts[];
   int n = StringSplit(RobotMap, ';', parts);
   for(int i = 0; i < n; i++)
     {
      string kv[];
      if(StringSplit(parts[i], '=', kv) != 2)
         continue;
      StringTrimLeft(kv[0]);
      StringTrimRight(kv[0]);
      StringTrimLeft(kv[1]);
      StringTrimRight(kv[1]);
      AddRobot(kv[1], StringToInteger(kv[0]));
     }
   if(g_n == 0)
      Print("RobotOfficeReporter: RobotMap inválido. Use o formato 1001=PA_01;1002=PA_02");
  }

int FindRobot(long magic)
  {
   if(g_n > 0 && g_robots[0].magic == -1)
      return 0;
   for(int i = 0; i < g_n; i++)
      if(g_robots[i].magic == magic)
         return i;
   return -1;
  }

void PushTrade(int r, long ts, string symbol, string side, string setup, double pnl)
  {
   if(g_robots[r].ntr == MAX_TRADES)
     {
      for(int k = 1; k < MAX_TRADES; k++)
         g_robots[r].tr[k - 1] = g_robots[r].tr[k];
      g_robots[r].ntr--;
     }
   int p = g_robots[r].ntr;
   g_robots[r].tr[p].ts = ts;
   g_robots[r].tr[p].symbol = symbol;
   g_robots[r].tr[p].side = side;
   g_robots[r].tr[p].setup = setup;
   g_robots[r].tr[p].pnl = pnl;
   g_robots[r].ntr++;
  }

//--- coleta -------------------------------------------------------------
void Collect()
  {
   for(int i = 0; i < g_n; i++)
     {
      g_robots[i].positions = 0;
      g_robots[i].openPnl = 0;
      g_robots[i].closedPnl = 0;
      g_robots[i].symbol = "";
      g_robots[i].side = "";
      g_robots[i].setup = "";
      g_robots[i].ntr = 0;
     }

   // posições abertas
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong ticket = PositionGetTicket(i);
      if(ticket == 0)
         continue;
      int r = FindRobot(PositionGetInteger(POSITION_MAGIC));
      if(r < 0)
         continue;
      g_robots[r].positions++;
      g_robots[r].openPnl += PositionGetDouble(POSITION_PROFIT) + PositionGetDouble(POSITION_SWAP);
      if(g_robots[r].positions == 1)
        {
         g_robots[r].symbol = PositionGetString(POSITION_SYMBOL);
         g_robots[r].side = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY) ? "BUY" : "SELL";
         g_robots[r].setup = PositionGetString(POSITION_COMMENT);
        }
     }

   // histórico de negócios: P&L fechado e últimas operações
   datetime now = TimeCurrent();
   datetime from = OnlyToday ? StringToTime(TimeToString(now, TIME_DATE)) : now - 7 * 86400;
   if(!HistorySelect(from, now + 60))
      return;
   long gmtOff = (long)(TimeGMT() - TimeCurrent());
   int total = HistoryDealsTotal();
   for(int i = 0; i < total; i++)
     {
      ulong deal = HistoryDealGetTicket(i);
      if(deal == 0)
         continue;
      long type = HistoryDealGetInteger(deal, DEAL_TYPE);
      if(type != DEAL_TYPE_BUY && type != DEAL_TYPE_SELL)
         continue; // ignora depósitos, créditos, etc.
      int r = FindRobot(HistoryDealGetInteger(deal, DEAL_MAGIC));
      if(r < 0)
         continue;
      double pnl = HistoryDealGetDouble(deal, DEAL_PROFIT) + HistoryDealGetDouble(deal, DEAL_COMMISSION)
                   + HistoryDealGetDouble(deal, DEAL_SWAP) + HistoryDealGetDouble(deal, DEAL_FEE);
      g_robots[r].closedPnl += pnl; // inclui custos da entrada
      long entry = HistoryDealGetInteger(deal, DEAL_ENTRY);
      if(entry != DEAL_ENTRY_OUT && entry != DEAL_ENTRY_OUT_BY && entry != DEAL_ENTRY_INOUT)
         continue;
      // negócio de saída: um BUY fecha uma posição SELL e vice-versa
      string side = (type == DEAL_TYPE_BUY) ? "SELL" : "BUY";
      PushTrade(r, (long)HistoryDealGetInteger(deal, DEAL_TIME) + gmtOff, HistoryDealGetString(deal, DEAL_SYMBOL), side,
                HistoryDealGetString(deal, DEAL_COMMENT), pnl);
     }
  }

string BuildJson()
  {
   double balance = AccountInfoDouble(ACCOUNT_BALANCE);
   string j = "{\"source\":\"mt5\",\"robots\":[";
   for(int i = 0; i < g_n; i++)
     {
      if(i > 0)
         j += ",";
      bool op = g_robots[i].positions > 0;
      j += "{\"id\":\"" + Esc(g_robots[i].id) + "\",\"status\":\"" + (op ? "operating" : "rest") + "\"";
      if(op)
         j += ",\"symbol\":\"" + Esc(g_robots[i].symbol) + "\",\"side\":\"" + g_robots[i].side + "\",\"setup\":\"" + Esc(g_robots[i].setup) + "\"";
      j += ",\"openPnl\":" + Num(g_robots[i].openPnl) + ",\"closedPnl\":" + Num(g_robots[i].closedPnl) + ",\"balance\":" + Num(balance);
      j += ",\"trades\":[";
      for(int k = 0; k < g_robots[i].ntr; k++)
        {
         if(k > 0)
            j += ",";
         j += "{\"ts\":" + (string)g_robots[i].tr[k].ts + ",\"symbol\":\"" + Esc(g_robots[i].tr[k].symbol) + "\",\"side\":\""
              + g_robots[i].tr[k].side + "\",\"setup\":\"" + Esc(g_robots[i].tr[k].setup) + "\",\"pnl\":" + Num(g_robots[i].tr[k].pnl) + "}";
        }
      j += "]}";
     }
   j += "]}";
   return j;
  }

void Report()
  {
   Collect();
   string json = BuildJson();
   char data[], result[];
   string resultHeaders;
   int len = StringToCharArray(json, data, 0, WHOLE_ARRAY, CP_UTF8);
   ArrayResize(data, len - 1); // tira o terminador nulo
   string headers = "Content-Type: application/json\r\n";
   if(StringLen(Token) > 0)
      headers += "X-Token: " + Token + "\r\n";
   ResetLastError();
   int code = WebRequest("POST", ServerUrl, headers, 3000, data, result, resultHeaders);
   if(code == 200)
      return;
   // não inunda o log: avisa no máximo a cada 60 s
   if(TimeLocal() - g_lastWarn < 60)
      return;
   g_lastWarn = TimeLocal();
   if(code == -1)
      PrintFormat("RobotOfficeReporter: WebRequest falhou (erro %d). Se for 4014, adicione %s em Ferramentas > Opções > Expert Advisors > URLs permitidas.", GetLastError(), ServerUrl);
   else
      PrintFormat("RobotOfficeReporter: o agregador respondeu HTTP %d", code);
  }

//--- eventos ------------------------------------------------------------
int OnInit()
  {
   ParseMap();
   if(g_n == 0)
      return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(MathMax(1, ReportSeconds));
   PrintFormat("RobotOfficeReporter: reportando %d robô(s) para %s a cada %d s", g_n, ServerUrl, MathMax(1, ReportSeconds));
   Report();
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
  }

void OnTimer()
  {
   Report();
  }

void OnTick() {}
//+------------------------------------------------------------------+
