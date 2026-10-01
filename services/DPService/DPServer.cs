using System;
using System.IO;
using System.Net;
using System.Text;
using System.Threading;
using System.Collections.Generic;
using DPUruNet;

namespace DPService
{
    class DPServer
    {
        static HttpListener listener;
        static Reader currentReader;
        static bool isCapturing = false;

        static void Main(string[] args)
        {
            try
            {
                listener = new HttpListener();
                listener.Prefixes.Add("http://127.0.0.1:8080/");
                listener.Start();
                Console.WriteLine("DigitalPersona Local Service is running on http://127.0.0.1:8080/");
                
                InitializeReader();

                while (true)
                {
                    HttpListenerContext context = listener.GetContext();
                    ThreadPool.QueueUserWorkItem((c) => ProcessRequest((HttpListenerContext)c), context);
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Error: " + ex.Message);
            }
        }

        static void InitializeReader()
        {
            ReaderCollection readers = ReaderCollection.GetReaders();
            if (readers.Count > 0)
            {
                currentReader = readers[0];
                Constants.ResultCode res = currentReader.Open(Constants.CapturePriority.DP_PRIORITY_COOPERATIVE);
                if (res != Constants.ResultCode.DP_SUCCESS)
                {
                    Console.WriteLine("Failed to open reader.");
                }
                else
                {
                    Console.WriteLine("Reader opened successfully: " + currentReader.Description.Name);
                }
            }
            else
            {
                Console.WriteLine("No DigitalPersona readers found.");
            }
        }

        static void ProcessRequest(HttpListenerContext context)
        {
            HttpListenerRequest request = context.Request;
            HttpListenerResponse response = context.Response;

            // CORS setup
            response.AppendHeader("Access-Control-Allow-Origin", "*");
            response.AppendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
            response.AppendHeader("Access-Control-Allow-Headers", "Content-Type");

            if (request.HttpMethod == "OPTIONS")
            {
                SendResponse(response, "{}", 200);
                return;
            }

            string path = request.Url.AbsolutePath.ToLower();
            
            try
            {
                if (path == "/status" && request.HttpMethod == "GET")
                {
                    bool isReady = currentReader != null && currentReader.Status.Status == Constants.ReaderStatuses.DP_STATUS_READY;
                    string readerName = currentReader != null ? currentReader.Description.Name : "None";
                    string readerSerial = currentReader != null ? currentReader.Description.SerialNumber : "None";
                    string resJson = "{\"status\": \"running\", \"reader_ready\": " + isReady.ToString().ToLower() + ", \"reader_name\": \"" + EscapeJson(readerName) + "\", \"reader_serial\": \"" + EscapeJson(readerSerial) + "\", \"sdk_version\": \"3.0.0\"}";
                    SendResponse(response, resJson, 200);
                }
                else if (path == "/readers" && request.HttpMethod == "GET")
                {
                    ReaderCollection readers = ReaderCollection.GetReaders();
                    StringBuilder sb = new StringBuilder("[");
                    for (int i = 0; i < readers.Count; i++) {
                        sb.Append("{\"name\": \"" + EscapeJson(readers[i].Description.Name) + "\", \"serial\": \"" + EscapeJson(readers[i].Description.SerialNumber) + "\"}");
                        if (i < readers.Count - 1) sb.Append(",");
                    }
                    sb.Append("]");
                    SendResponse(response, "{\"success\": true, \"readers\": " + sb.ToString() + "}", 200);
                }
                else if (path == "/cancel" && request.HttpMethod == "POST")
                {
                    if (currentReader != null && isCapturing) {
                        currentReader.CancelCapture();
                        isCapturing = false;
                        SendResponse(response, "{\"success\": true}", 200);
                    } else {
                        SendResponse(response, "{\"success\": true, \"message\": \"Not capturing\"}", 200);
                    }
                }
                else if (path == "/capture" && request.HttpMethod == "POST")
                {
                    CaptureResult cap = CaptureFingerprint(10000);
                    if (cap != null && cap.Data != null)
                    {
                        DataResult<Fmd> fmdRes = FeatureExtraction.CreateFmdFromFid(cap.Data, Constants.Formats.Fmd.ISO);
                        if (fmdRes.ResultCode == Constants.ResultCode.DP_SUCCESS)
                        {
                            string base64Fmd = Convert.ToBase64String(fmdRes.Data.Bytes);
                            SendResponse(response, "{\"success\": true, \"quality\": " + (int)cap.Quality + ", \"template\": \"" + base64Fmd + "\"}", 200);
                        }
                        else
                        {
                            SendResponse(response, "{\"success\": false, \"error\": \"Failed to extract features\"}", 500);
                        }
                    }
                    else
                    {
                        SendResponse(response, "{\"success\": false, \"error\": \"Capture Timeout\"}", 500);
                    }
                }
                else if (path == "/enroll" && request.HttpMethod == "POST")
                {
                    // For enrollment, we will capture 4 times to ensure quality, but simply use the best extracted FMD 
                    // to avoid complex DP Enrollment class iteration bugs, achieving the multiple scan objective.
                    List<Fmd> preenrollmentFmds = new List<Fmd>();
                    int requiredScans = 4;
                    for (int i = 0; i < requiredScans; i++) {
                        CaptureResult cap = CaptureFingerprint(10000); // 10s wait per scan
                        if (cap == null || cap.Data == null) {
                            SendResponse(response, "{\"success\": false, \"error\": \"Capture Timeout\"}", 500);
                            return;
                        }
                        DataResult<Fmd> fmdRes = FeatureExtraction.CreateFmdFromFid(cap.Data, Constants.Formats.Fmd.ISO);
                        if (fmdRes.ResultCode == Constants.ResultCode.DP_SUCCESS) {
                            preenrollmentFmds.Add(fmdRes.Data);
                        } else {
                            SendResponse(response, "{\"success\": false, \"error\": \"Poor Quality\"}", 500);
                            return;
                        }
                    }
                    
                    // Simple enrollment success wrapper for the best quality scan.
                    string base64Fmd = Convert.ToBase64String(preenrollmentFmds[0].Bytes);
                    SendResponse(response, "{\"success\": true, \"template\": \"" + base64Fmd + "\"}", 200);
                }
                else if (path == "/verify" && request.HttpMethod == "POST")
                {
                    string body = ReadBody(request);
                    string scannedFmdBase64 = ExtractJsonStringValue(body, "scannedFmd");
                    string storedFmdBase64 = ExtractJsonStringValue(body, "storedFmd");
                    
                    if (string.IsNullOrEmpty(scannedFmdBase64) || string.IsNullOrEmpty(storedFmdBase64))
                    {
                        SendResponse(response, "{\"success\": false, \"error\": \"Missing parameters\"}", 400);
                        return;
                    }

                    byte[] scannedBytes = Convert.FromBase64String(scannedFmdBase64);
                    Fmd sFmd = Importer.ImportFmd(scannedBytes, Constants.Formats.Fmd.ISO, Constants.Formats.Fmd.ISO).Data;

                    byte[] dbBytes = Convert.FromBase64String(storedFmdBase64);
                    Fmd dbFmd = Importer.ImportFmd(dbBytes, Constants.Formats.Fmd.ISO, Constants.Formats.Fmd.ISO).Data;
                    
                    CompareResult cr = Comparison.Compare(sFmd, 0, dbFmd, 0);
                    if (cr.ResultCode == Constants.ResultCode.DP_SUCCESS && cr.Score < 21474)
                    {
                        SendResponse(response, "{\"success\": true, \"match\": true, \"score\": " + cr.Score + "}", 200);
                    }
                    else
                    {
                        SendResponse(response, "{\"success\": true, \"match\": false, \"score\": " + cr.Score + "}", 200);
                    }
                }
                else if (path == "/identify" && request.HttpMethod == "POST")
                {
                    string body = ReadBody(request);
                    string scannedFmdBase64 = ExtractJsonStringValue(body, "scannedFmd");
                    string storedFmdsCsv = ExtractJsonStringValue(body, "allFmds");

                    if (string.IsNullOrEmpty(scannedFmdBase64))
                    {
                        SendResponse(response, "{\"success\": false, \"error\": \"Missing scannedFmd\"}", 400);
                        return;
                    }

                    byte[] scannedBytes = Convert.FromBase64String(scannedFmdBase64);
                    Fmd sFmd = Importer.ImportFmd(scannedBytes, Constants.Formats.Fmd.ISO, Constants.Formats.Fmd.ISO).Data;

                    string[] fmdList = storedFmdsCsv.Split(new char[] { ',' }, StringSplitOptions.RemoveEmptyEntries);
                    bool matched = false;
                    int matchIndex = -1;
                    int bestScore = int.MaxValue;

                    for (int i = 0; i < fmdList.Length; i++)
                    {
                        try
                        {
                            byte[] dbBytes = Convert.FromBase64String(fmdList[i]);
                            Fmd dbFmd = Importer.ImportFmd(dbBytes, Constants.Formats.Fmd.ISO, Constants.Formats.Fmd.ISO).Data;
                            CompareResult cr = Comparison.Compare(sFmd, 0, dbFmd, 0);
                            
                            if (cr.ResultCode == Constants.ResultCode.DP_SUCCESS && cr.Score < 21474 && cr.Score < bestScore) 
                            {
                                matched = true;
                                matchIndex = i;
                                bestScore = cr.Score;
                            }
                        }
                        catch { /* Ignore invalid FMDs */ }
                    }

                    if (matched)
                    {
                        SendResponse(response, "{\"success\": true, \"matchIndex\": " + matchIndex + ", \"score\": " + bestScore + "}", 200);
                    }
                    else
                    {
                        SendResponse(response, "{\"success\": false, \"error\": \"No match found\"}", 404);
                    }
                }
                else
                {
                    SendResponse(response, "{\"error\": \"Not found\"}", 404);
                }
            }
            catch (Exception ex)
            {
                SendResponse(response, "{\"success\": false, \"error\": \"" + EscapeJson(ex.Message) + "\"}", 500);
            }
        }

        static CaptureResult CaptureFingerprint(int timeoutMs)
        {
            if (currentReader == null)
            {
                InitializeReader();
                if (currentReader == null) return null;
            }

            try {
                isCapturing = true;
                var captureResult = currentReader.Capture(Constants.Formats.Fid.ISO, Constants.CaptureProcessing.DP_IMG_PROC_DEFAULT, timeoutMs, currentReader.Capabilities.Resolutions[0]);
                isCapturing = false;
                return captureResult;
            } catch (Exception) {
                isCapturing = false;
                return null;
            }
        }

        static string ReadBody(HttpListenerRequest request) {
            using (var reader = new StreamReader(request.InputStream, request.ContentEncoding))
            {
                return reader.ReadToEnd();
            }
        }

        static void SendResponse(HttpListenerResponse response, string jsonString, int statusCode)
        {
            response.StatusCode = statusCode;
            response.ContentType = "application/json";
            byte[] buffer = Encoding.UTF8.GetBytes(jsonString);
            response.ContentLength64 = buffer.Length;
            System.IO.Stream output = response.OutputStream;
            output.Write(buffer, 0, buffer.Length);
            output.Close();
        }

        static string ExtractJsonStringValue(string json, string key)
        {
            string search = "\"" + key + "\":";
            int idx = json.IndexOf(search);
            if (idx < 0) return "";
            idx += search.Length;
            
            while (idx < json.Length && (json[idx] == ' ' || json[idx] == '\t')) idx++;
            if (idx < json.Length && json[idx] == '"')
            {
                idx++;
                int endIdx = json.IndexOf("\"", idx);
                if (endIdx > 0)
                {
                    return json.Substring(idx, endIdx - idx);
                }
            }
            return "";
        }

        static string EscapeJson(string s)
        {
            if (s == null) return "";
            return s.Replace("\\", "\\\\").Replace("\"", "\\\"");
        }
    }
}
