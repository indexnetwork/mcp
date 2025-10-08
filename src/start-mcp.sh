#!/bin/zsh
# MCP Server Startup Script

echo "🔄 Stopping existing processes..."
pkill -f "ngrok" 2>/dev/null
pkill -f "npm run dev" 2>/dev/null
pkill -f "inspector" 2>/dev/null
lsof -ti:6277 | xargs kill -9 2>/dev/null

echo "🚀 Starting MCP Server..."
cd /Users/imertkaradayi/Development/workspace/mcp
npm run dev &
MCP_PID=$!

echo "🌐 Starting ngrok tunnel..."
ngrok http 3002 &
NGROK_PID=$!

echo "🔍 Starting MCP Inspector..."
npx @modelcontextprotocol/inspector@latest &
INSPECTOR_PID=$!

echo "✅ All services started!"
echo "📊 Process IDs:"
echo "   MCP Server: $MCP_PID"
echo "   ngrok: $NGROK_PID" 
echo "   Inspector: $INSPECTOR_PID"
echo ""
echo "🔗 MCP Server: http://localhost:3002/mcp"
# Get the actual ngrok URL dynamically
sleep 2  # Give ngrok time to start
NGROK_URL=$(curl -s http://localhost:4040/api/tunnels | grep -o '"public_url":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$NGROK_URL" ]; then
    echo "🌍 ngrok URL: $NGROK_URL/mcp"
else
    echo "🌍 ngrok URL: (starting up... check http://localhost:4040 for status)"
fi
echo "🔍 Inspector: http://localhost:6274"
echo ""
echo "Press Ctrl+C to stop all services"

# Wait for interrupt
trap 'echo "🛑 Stopping services..."; kill $MCP_PID $NGROK_PID $INSPECTOR_PID 2>/dev/null; exit' INT
wait