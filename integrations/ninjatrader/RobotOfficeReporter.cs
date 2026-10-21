// RobotOfficeReporter — AddOn do NinjaTrader 8.
// Cada conta mapeada em robot-office.txt vira um robô no escritório virtual:
// posição aberta => "operating"; sem posição => "rest". Só lê e reporta, não opera.
//
// Instalação: veja integrations/README.md.
#region Using declarations
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Text;
using NinjaTrader.Cbi;
using NinjaTrader.NinjaScript;
#endregion

namespace NinjaTrader.NinjaScript.AddOns
{
	public class RobotOfficeReporter : AddOnBase
	{
		const int ReportMs = 5000;
		const int MaxTrades = 12;

		class TradeRec { public long Ts; public string Symbol; public string Side; public double Pnl; }

		string url = "http://127.0.0.1:8787/report";
		string token = "";
		readonly Dictionary<string, string> accountToRobot = new Dictionary<string, string>(); // conta NT -> id do robô
		readonly Dictionary<string, double> lastRealized = new Dictionary<string, double>();
		readonly Dictionary<string, string> lastSymbol = new Dictionary<string, string>();
		readonly Dictionary<string, string> lastSide = new Dictionary<string, string>();
		readonly Dictionary<string, List<TradeRec>> trades = new Dictionary<string, List<TradeRec>>();
		System.Threading.Timer timer;
		DateTime lastWarn = DateTime.MinValue;
		int busy;

		protected override void OnStateChange()
		{
			if (State == State.SetDefaults)
			{
				Name = "RobotOfficeReporter";
				Description = "Reporta contas/posições ao escritório virtual de robôs.";
			}
			else if (State == State.Active)
			{
				if (!LoadConfig())
					return;
				Print("RobotOfficeReporter: reportando " + accountToRobot.Count + " conta(s) para " + url);
				timer = new System.Threading.Timer(delegate { Report(); }, null, 3000, ReportMs);
			}
			else if (State == State.Terminated)
			{
				if (timer != null) { timer.Dispose(); timer = null; }
			}
		}

		// robot-office.txt (na pasta "NinjaTrader 8" em Documentos):
		//   url=http://127.0.0.1:8787/report
		//   token=
		//   account:Sim101=NT_01
		//   account:MinhaContaProp=NT_02
		bool LoadConfig()
		{
			string path = Path.Combine(NinjaTrader.Core.Globals.UserDataDir, "robot-office.txt");
			if (!File.Exists(path))
			{
				File.WriteAllText(path,
					"url=http://127.0.0.1:8787/report\r\ntoken=\r\n# uma linha por conta: account:NOME_DA_CONTA_NO_NT=ID_DO_ROBO\r\naccount:Sim101=NT_01\r\n");
				Print("RobotOfficeReporter: criei o modelo " + path + ". Edite e reinicie o NinjaTrader.");
			}
			accountToRobot.Clear();
			foreach (string raw in File.ReadAllLines(path))
			{
				string line = raw.Trim();
				if (line.Length == 0 || line.StartsWith("#")) continue;
				int eq = line.IndexOf('=');
				if (eq < 0) continue;
				string key = line.Substring(0, eq).Trim();
				string val = line.Substring(eq + 1).Trim();
				if (key == "url" && val.Length > 0) url = val;
				else if (key == "token") token = val;
				else if (key.StartsWith("account:")) accountToRobot[key.Substring("account:".Length).Trim()] = val;
			}
			if (accountToRobot.Count == 0)
			{
				Print("RobotOfficeReporter: nenhuma linha account:... em " + path);
				return false;
			}
			return true;
		}

		static string Esc(string s)
		{
			return (s ?? "").Replace("\\", "\\\\").Replace("\"", "\\\"").Replace("\r", " ").Replace("\n", " ").Replace("\t", " ");
		}

		static string Num(double v) { return v.ToString("0.00", CultureInfo.InvariantCulture); }

		void Report()
		{
			if (System.Threading.Interlocked.Exchange(ref busy, 1) == 1) return; // evita relatórios sobrepostos
			try
			{
				string json = BuildJson();
				using (var wc = new WebClient())
				{
					wc.Encoding = Encoding.UTF8;
					wc.Headers[HttpRequestHeader.ContentType] = "application/json";
					if (token.Length > 0) wc.Headers["X-Token"] = token;
					wc.UploadString(url, "POST", json);
				}
			}
			catch (Exception ex)
			{
				if ((DateTime.Now - lastWarn).TotalSeconds > 60)
				{
					lastWarn = DateTime.Now;
					Print("RobotOfficeReporter: falha ao enviar para " + url + " — " + ex.Message);
				}
			}
			finally { System.Threading.Interlocked.Exchange(ref busy, 0); }
		}

		string BuildJson()
		{
			var sb = new StringBuilder("{\"source\":\"ninjatrader\",\"robots\":[");
			bool first = true;
			long nowTs = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
			lock (Account.All)
			{
				foreach (Account acct in Account.All)
				{
					string robotId;
					if (!accountToRobot.TryGetValue(acct.Name, out robotId)) continue;

					double unrealized = acct.Get(AccountItem.UnrealizedProfitLoss, Currency.UsDollar);
					double realized = acct.Get(AccountItem.RealizedProfitLoss, Currency.UsDollar);
					double balance = acct.Get(AccountItem.CashValue, Currency.UsDollar);

					string symbol = null, side = null;
					lock (acct.Positions)
					{
						foreach (Position pos in acct.Positions)
						{
							if (pos.MarketPosition == MarketPosition.Flat) continue;
							symbol = pos.Instrument.MasterInstrument.Name;
							side = pos.MarketPosition == MarketPosition.Long ? "BUY" : "SELL";
							break;
						}
					}
					bool operating = symbol != null;
					if (operating) { lastSymbol[acct.Name] = symbol; lastSide[acct.Name] = side; }

					// o NinjaTrader não entrega "operação fechada" pronta aqui: uma variação do P&L realizado
					// entre dois relatórios vira uma operação (a primeira leitura só serve de referência)
					List<TradeRec> list;
					if (!trades.TryGetValue(acct.Name, out list)) { list = new List<TradeRec>(); trades[acct.Name] = list; }
					double prev;
					if (lastRealized.TryGetValue(acct.Name, out prev) && Math.Abs(realized - prev) >= 0.005)
					{
						string s0, d0;
						list.Add(new TradeRec
						{
							Ts = nowTs,
							Symbol = lastSymbol.TryGetValue(acct.Name, out s0) ? s0 : "-",
							Side = lastSide.TryGetValue(acct.Name, out d0) ? d0 : "BUY",
							Pnl = realized - prev
						});
						if (list.Count > MaxTrades) list.RemoveAt(0);
					}
					lastRealized[acct.Name] = realized;

					if (!first) sb.Append(',');
					first = false;
					sb.Append("{\"id\":\"").Append(Esc(robotId)).Append("\",\"status\":\"").Append(operating ? "operating" : "rest").Append('"');
					if (operating) sb.Append(",\"symbol\":\"").Append(Esc(symbol)).Append("\",\"side\":\"").Append(side).Append("\",\"setup\":\"FUTURES\"");
					sb.Append(",\"openPnl\":").Append(Num(unrealized)).Append(",\"closedPnl\":").Append(Num(realized)).Append(",\"balance\":").Append(Num(balance));
					sb.Append(",\"trades\":[");
					for (int i = 0; i < list.Count; i++)
					{
						if (i > 0) sb.Append(',');
						sb.Append("{\"ts\":").Append(list[i].Ts.ToString(CultureInfo.InvariantCulture)).Append(",\"symbol\":\"").Append(Esc(list[i].Symbol))
						  .Append("\",\"side\":\"").Append(list[i].Side).Append("\",\"setup\":\"FUTURES\",\"pnl\":").Append(Num(list[i].Pnl)).Append('}');
					}
					sb.Append("]}");
				}
			}
			sb.Append("]}");
			return sb.ToString();
		}
	}
}
