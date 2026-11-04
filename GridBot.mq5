//+------------------------------------------------------------------+
//|                                                      GridBot.mq5 |
//| Simple grid bot: buy limits below price, sell limits above.      |
//| Panel on chart: Start / Stop / Close All, lot size, step.        |
//| TEST ON A DEMO ACCOUNT FIRST. Grids can lose heavily in trends.  |
//+------------------------------------------------------------------+
#property copyright "GridBot"
#property version   "1.00"
#property strict

#include <Trade\Trade.mqh>

input double InpLots        = 0.01;   // Lot size per order
input int    InpStepPoints  = 200;    // Distance between orders (points)
input int    InpLevels      = 3;      // Levels above and below price
input int    InpTPPoints    = 200;    // Take profit per order (points)
input int    InpSLPoints    = 1500;   // Stop loss per order (points, 0 = none)
input double InpMaxDDPercent= 10.0;   // Emergency stop: max equity drawdown % (0 = off)
input ulong  InpMagic       = 20260411;

CTrade trade;
bool   running   = false;
double anchor    = 0.0;
double startEq   = 0.0;
double lots      = 0.0;
int    stepPts   = 0;

#define P_START  "GB_Start"
#define P_STOP   "GB_Stop"
#define P_CLOSE  "GB_CloseAll"
#define P_LOTS   "GB_Lots"
#define P_STEP   "GB_Step"
#define P_STATUS "GB_Status"

//--- UI helpers
void MakeButton(string name,string text,int x,int y,int w,int h,color bg)
{
   ObjectCreate(0,name,OBJ_BUTTON,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,name,OBJPROP_XSIZE,w);
   ObjectSetInteger(0,name,OBJPROP_YSIZE,h);
   ObjectSetString (0,name,OBJPROP_TEXT,text);
   ObjectSetInteger(0,name,OBJPROP_BGCOLOR,bg);
   ObjectSetInteger(0,name,OBJPROP_COLOR,clrWhite);
}
void MakeLabel(string name,string text,int x,int y)
{
   ObjectCreate(0,name,OBJ_LABEL,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetString (0,name,OBJPROP_TEXT,text);
   ObjectSetInteger(0,name,OBJPROP_COLOR,clrWhite);
}
void MakeEdit(string name,string text,int x,int y,int w)
{
   ObjectCreate(0,name,OBJ_EDIT,0,0,0);
   ObjectSetInteger(0,name,OBJPROP_XDISTANCE,x);
   ObjectSetInteger(0,name,OBJPROP_YDISTANCE,y);
   ObjectSetInteger(0,name,OBJPROP_XSIZE,w);
   ObjectSetInteger(0,name,OBJPROP_YSIZE,22);
   ObjectSetString (0,name,OBJPROP_TEXT,text);
}
void SetStatus(string s)
{
   ObjectSetString(0,P_STATUS,OBJPROP_TEXT,"Status: "+s);
}

//--- Order helpers
double NormLots(double v)
{
   double step=SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_STEP);
   double mn  =SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MIN);
   double mx  =SymbolInfoDouble(_Symbol,SYMBOL_VOLUME_MAX);
   v=MathFloor(v/step)*step;
   return MathMax(mn,MathMin(mx,NormalizeDouble(v,2)));
}

bool LevelExists(string cmt)
{
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong t=OrderGetTicket(i);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)==_Symbol && OrderGetInteger(ORDER_MAGIC)==(long)InpMagic
         && OrderGetString(ORDER_COMMENT)==cmt) return true;
   }
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong t=PositionGetTicket(i);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==(long)InpMagic
         && PositionGetString(POSITION_COMMENT)==cmt) return true;
   }
   return false;
}

void DeletePendings()
{
   for(int i=OrdersTotal()-1;i>=0;i--)
   {
      ulong t=OrderGetTicket(i);
      if(t==0) continue;
      if(OrderGetString(ORDER_SYMBOL)==_Symbol && OrderGetInteger(ORDER_MAGIC)==(long)InpMagic)
         trade.OrderDelete(t);
   }
}

void CloseAllPositions()
{
   for(int i=PositionsTotal()-1;i>=0;i--)
   {
      ulong t=PositionGetTicket(i);
      if(t==0) continue;
      if(PositionGetString(POSITION_SYMBOL)==_Symbol && PositionGetInteger(POSITION_MAGIC)==(long)InpMagic)
         trade.PositionClose(t);
   }
}

void MaintainGrid()
{
   double pt   =_Point;
   double ask  =SymbolInfoDouble(_Symbol,SYMBOL_ASK);
   double bid  =SymbolInfoDouble(_Symbol,SYMBOL_BID);
   double minD =SymbolInfoInteger(_Symbol,SYMBOL_TRADE_STOPS_LEVEL)*pt;
   int    dg   =(int)SymbolInfoInteger(_Symbol,SYMBOL_DIGITS);

   for(int i=1;i<=InpLevels;i++)
   {
      //--- Buy limit below anchor
      string cb="G-"+IntegerToString(i);
      double pb=NormalizeDouble(anchor-i*stepPts*pt,dg);
      if(!LevelExists(cb) && pb<ask-minD)
      {
         double sl=(InpSLPoints>0)?NormalizeDouble(pb-InpSLPoints*pt,dg):0;
         double tp=NormalizeDouble(pb+InpTPPoints*pt,dg);
         trade.BuyLimit(lots,pb,_Symbol,sl,tp,ORDER_TIME_GTC,0,cb);
      }
      //--- Sell limit above anchor
      string cs="G+"+IntegerToString(i);
      double ps=NormalizeDouble(anchor+i*stepPts*pt,dg);
      if(!LevelExists(cs) && ps>bid+minD)
      {
         double sl=(InpSLPoints>0)?NormalizeDouble(ps+InpSLPoints*pt,dg):0;
         double tp=NormalizeDouble(ps-InpTPPoints*pt,dg);
         trade.SellLimit(lots,ps,_Symbol,sl,tp,ORDER_TIME_GTC,0,cs);
      }
   }
}

void StartBot()
{
   lots   =NormLots(StringToDouble(ObjectGetString(0,P_LOTS,OBJPROP_TEXT)));
   stepPts=(int)StringToInteger(ObjectGetString(0,P_STEP,OBJPROP_TEXT));
   if(stepPts<=0){ SetStatus("invalid step"); return; }
   anchor =(SymbolInfoDouble(_Symbol,SYMBOL_ASK)+SymbolInfoDouble(_Symbol,SYMBOL_BID))/2.0;
   startEq=AccountInfoDouble(ACCOUNT_EQUITY);
   running=true;
   SetStatus("RUNNING  (anchor "+DoubleToString(anchor,_Digits)+")");
   MaintainGrid();
}

void StopBot()
{
   running=false;
   DeletePendings();
   SetStatus("STOPPED (open trades kept)");
}

//+------------------------------------------------------------------+
int OnInit()
{
   trade.SetExpertMagicNumber(InpMagic);
   trade.SetTypeFillingBySymbol(_Symbol);

   MakeLabel (P_STATUS,"Status: STOPPED",20,30);
   MakeButton(P_START,"START",20,55,80,28,clrSeaGreen);
   MakeButton(P_STOP,"STOP",105,55,80,28,clrFireBrick);
   MakeButton(P_CLOSE,"CLOSE ALL",190,55,90,28,clrDimGray);
   MakeLabel (P_LOTS+"_l","Lot size",20,92);
   MakeEdit  (P_LOTS,DoubleToString(InpLots,2),120,90,80);
   MakeLabel (P_STEP+"_l","Step (points)",20,120);
   MakeEdit  (P_STEP,IntegerToString(InpStepPoints),120,118,80);
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   ObjectsDeleteAll(0,"GB_");
}

void OnTick()
{
   if(!running) return;

   if(InpMaxDDPercent>0 && startEq>0)
   {
      double eq=AccountInfoDouble(ACCOUNT_EQUITY);
      if(eq<startEq*(1.0-InpMaxDDPercent/100.0))
      {
         DeletePendings();
         CloseAllPositions();
         running=false;
         SetStatus("STOPPED - max drawdown hit");
         return;
      }
   }
   MaintainGrid();
}

void OnChartEvent(const int id,const long &l,const double &d,const string &name)
{
   if(id!=CHARTEVENT_OBJECT_CLICK) return;
   if(name==P_START){ ObjectSetInteger(0,P_START,OBJPROP_STATE,false); if(!running) StartBot(); }
   if(name==P_STOP) { ObjectSetInteger(0,P_STOP,OBJPROP_STATE,false);  StopBot(); }
   if(name==P_CLOSE){ ObjectSetInteger(0,P_CLOSE,OBJPROP_STATE,false); StopBot(); CloseAllPositions(); SetStatus("STOPPED - all closed"); }
}
//+------------------------------------------------------------------+
