#!/usr/bin/env python3
"""职责：VM 内固定 HTTP 工具、有限模拟和短期许可。 Fixed guest HTTP executor and finite mock server."""
import sys, os, json, hashlib, time, uuid, socket, threading, http.client, http.server, ssl, re, urllib.parse, ipaddress, signal

def canonical(v):
    return json.dumps(v, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
def digest(v):
    return hashlib.sha256(canonical(v).encode()).hexdigest()
def emit(v):
    sys.stdout.write('SAKURA_INTEGRATION ' + canonical(v) + '\n'); sys.stdout.flush()
def require(value, code):
    if not value: raise RuntimeError(code)
def pointer(value, path):
    if not path: return value
    for key in path[1:].split('/'):
        key=key.replace('~1','/').replace('~0','~')
        try: value=value[int(key)] if isinstance(value,list) else value[key]
        except (KeyError,IndexError,TypeError,ValueError): return None
    return value
def matches(v,s,schemas=None,depth=0):
    if depth>16:return False
    if 'ref' in s:return matches(v,(schemas or {})[s['ref']],schemas,depth+1)
    if 'enum' in s and v not in s['enum']:return False
    t=s['type']
    if t=='null':return v is None
    if t=='boolean':return type(v)==bool
    if t in ('number','integer'):return type(v) in (int,float) and (t!='integer' or int(v)==v) and s.get('minimum',float('-inf'))<=v<=s.get('maximum',float('inf'))
    if t=='string':return type(v)==str and s.get('minLength',0)<=len(v)<=s.get('maxLength',65536)
    if t=='array':return type(v)==list and s.get('minItems',0)<=len(v)<=s.get('maxItems',10000) and all(matches(x,s['items'],schemas,depth+1) for x in v)
    if t=='object':return type(v)==dict and all(k in v for k in s.get('required',[])) and all(matches(x,s['properties'][k],schemas,depth+1) if k in s.get('properties',{}) else s['additionalProperties'] for k,x in v.items())
    return False

def control(session):
    require(re.fullmatch('[a-f0-9-]{36}',session),'SESSION_INVALID')
    data=sys.stdin.buffer.read(4*1024*1024+1);require(len(data)<=4*1024*1024,'CONTROL_SIZE')
    sock=socket.socket(socket.AF_UNIX);sock.settimeout(2);sock.connect('/workspace/integration-lab/control-'+session+'.sock');sock.sendall(data+b'\n');sock.shutdown(socket.SHUT_WR);sock.close()

class Engine:
    def __init__(self,m):
        self.m=m;self.session=m['sessionId'];self.start=time.monotonic();self.deadline=__import__('datetime').datetime.fromisoformat(m['deadline'].replace('Z','+00:00')).timestamp();self.stop=threading.Event();self.cv=threading.Condition();self.pending={};self.evidence={};self.dispatched=0;self.completed=0;self.output_bytes=0;self.intervals=[];self.last_dispatch=None;self.server=None;self.state=m['mock']['initialState'] if m['mock'] else None;self.lock=threading.Lock();self.port=0;self.last_authorized=0
        seconds=self.deadline-time.time();require(0<seconds<=1800,'DEADLINE_INVALID');self.monotonic_deadline=self.start+seconds
        require(m['toolId']=='integration-http-v1' and m['maxConcurrent']==1 and 0<m['rate']<=100 and 0<m['maxBytes']<=64*1024**2,'BUDGET_INVALID')
        require(m['maxRequests']<= (6000 if m['mode']=='load' else 200),'REQUEST_BUDGET')
        require(m['mode']!='load' or m['environment']['target']['kind']=='mock' and seconds<=60.1,'LOAD_TARGET_FORBIDDEN')
        require(m['mode']=='mock-only' or seconds<=(60.1 if m['mode']=='load' else 600.1),'TIME_BUDGET')
        self.sock=socket.socket(socket.AF_UNIX);self.sockpath='/workspace/integration-lab/control-'+self.session+'.sock';self.sock.bind(self.sockpath);os.chmod(self.sockpath,0o600);self.sock.listen(2);self.sock.settimeout(.2)
    def alive(self):
        require(not self.stop.is_set() and time.time()<self.deadline and time.monotonic()<self.monotonic_deadline,'DEADLINE_OR_CANCELLED')
    def listen(self):
        while not self.stop.is_set():
            try:
                c,_=self.sock.accept();c.settimeout(.3);data=b''
                with c:
                    while len(data)<=4*1024*1024:
                        piece=c.recv(65536)
                        if not piece:break
                        data+=piece
                value=json.loads(data)
                if value.get('sessionId')!=self.session:continue
                if value.get('action')=='stop':self.stop.set();continue
                with self.cv:
                    challenge=value.get('challenge')
                    if challenge in self.pending and self.pending[challenge] is None:self.pending[challenge]=value;self.cv.notify_all()
            except (socket.timeout,ValueError,OSError):pass
    def authorize(self,kind,seq,requests):
        self.alive();challenge=str(uuid.uuid4());created=time.monotonic();request_digest=digest(requests)
        with self.cv:self.pending[challenge]=None
        emit(dict(type=kind,sessionId=self.session,challenge=challenge,sequence=seq,digest=request_digest,requests=requests))
        with self.cv:
            while self.pending[challenge] is None and time.monotonic()-created<2 and not self.stop.is_set():self.cv.wait(.02)
            grant=self.pending.pop(challenge,None)
        self.alive();require(grant and time.monotonic()-created<2 and grant.get('digest')==request_digest and grant.get('allow') is True,'PERMIT_EXPIRED')
        require(set(grant.get('secretHeaders',{}))==set(self.m['credentialVersions']),'SECRET_SET_CHANGED')
        return grant,created
    def mock(self):
        engine=self
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version='HTTP/1.1'
            def log_message(self,*args):pass
            def do_GET(self):self.handle_request()
            do_POST=do_PUT=do_PATCH=do_DELETE=do_OPTIONS=do_HEAD=do_GET
            def handle_request(self):
                try:
                    engine.alive();require(engine.last_authorized and time.monotonic()-engine.last_authorized<2,'AUTHORIZATION_EXPIRED');length=int(self.headers.get('content-length','0'));require(0<=length<=1024**2,'REQUEST_BODY_TOO_LARGE');self.rfile.read(length)
                    route=urllib.parse.urlsplit(self.path).path;operation=None
                    for op in engine.m['contract']['operations']:
                        pattern=re.escape(op['path']);pattern=re.sub(r'\\\{[^}]+\\\}',r'[^/]+',pattern)
                        if op['method']==self.command and re.fullmatch(pattern,route):operation=op['operationId'];break
                    with engine.lock:
                        rule=next((r for r in engine.m['mock']['rules'] if r['operationId']==operation and ('state' not in r or r['state']==engine.state)),None)
                        if rule is None:self.send_response(404);self.send_header('Content-Length','0');self.end_headers();return
                        if 'nextState' in rule:engine.state=rule['nextState']
                    if engine.stop.wait(rule['fault']['delayMs']/1000):return
                    if rule['fault']['disconnect']:self.connection.shutdown(socket.SHUT_RDWR);self.connection.close();return
                    body=rule['body']
                    if 'fixture' in rule:body=engine.m['fixtures'][rule['fixture']['index']]['rows'][rule['fixture']['row']]
                    data=canonical(body).encode();self.send_response(rule['status']);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)))
                    for k,v in rule['headers'].items():self.send_header(k,v)
                    self.end_headers()
                    if self.command!='HEAD':self.wfile.write(data[:rule['fault'].get('truncateBytes',len(data))]);self.wfile.flush()
                    if 'truncateBytes' in rule['fault']:self.connection.shutdown(socket.SHUT_RDWR);self.connection.close()
                except (OSError,RuntimeError):self.close_connection=True
        self.server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);self.server.daemon_threads=True;self.port=self.server.server_address[1];threading.Thread(target=self.server.serve_forever,daemon=True).start()
    def request(self,node):
        op=next(o for o in self.m['contract']['operations'] if o['operationId']==node['operationId']);path=dict(node['path']);query=dict(node['query']);body=json.loads(canonical(self.m['fixtures'][node['fixture']['index']]['rows'][node['fixture']['row']] if 'fixture' in node else node['body']))
        for b in node['bindings']:
            source=self.evidence.get(b['from']);require(source and source['complete'],'BINDING_SOURCE_UNAVAILABLE');v=pointer(source.get('body'),b['pointer']);require(matches(v,b['shape']),'BINDING_OUT_OF_SCOPE');target=path if b['to']=='path' else query if b['to']=='query' else body;require(type(target)==dict and b['field'] not in ('__proto__','constructor','prototype'),'BINDING_OUT_OF_SCOPE');target[b['field']]=v
        route=op['path']
        for p in op['pathParameters']:
            require(matches(path.get(p['name']),p['schema'],self.m['contract']['schemas']),'REQUEST_PARAMETER_INVALID');route=route.replace('{'+p['name']+'}',urllib.parse.quote(str(path[p['name']]),safe="~!*'()-._"))
        if query:route+='?'+urllib.parse.urlencode(sorted(query.items()))
        require(matches(body,op['request'],self.m['contract']['schemas']) if op['request'] else body is None,'REQUEST_BODY_INVALID')
        return dict(node=node['id'],method=op['method'],path=route,body=body,bodyDigest=digest(body),effect=op['effect'])
    def send(self,request,sequence,headers):
        self.alive();require(self.dispatched<self.m['maxRequests'],'REQUEST_BUDGET');target=self.m['environment']['target'];timeout=min(15,self.deadline-time.time(),self.monotonic_deadline-time.monotonic());conn=None;started=time.monotonic();at=__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat().replace('+00:00','Z');error=None;status=None;body=None;response_digest=None;count=0;response_headers={};complete=False
        if self.last_dispatch is not None:self.intervals.append((started-self.last_dispatch)*1000)
        self.last_dispatch=started;self.dispatched+=1
        try:
            if target['kind']=='mock':conn=http.client.HTTPConnection('127.0.0.1',self.port,timeout=timeout)
            else:
                address=target['address'];ip=ipaddress.IPv4Address(address);require(ip.is_private and not ip.is_loopback and not ip.is_link_local and not ip.is_multicast and address not in ('10.0.2.2','10.0.2.3','10.0.2.15'),'DESTINATION_FORBIDDEN')
                conn=http.client.HTTPConnection(address,target['port'],timeout=timeout)
                if target['protocol']=='https':
                    conn.connect();conn.sock=ssl.create_default_context().wrap_socket(conn.sock,server_hostname=target['tlsName'])
            payload=None if request['body'] is None else canonical(request['body']).encode();require(payload is None or len(payload)<=1024**2,'REQUEST_BODY_TOO_LARGE');conn.request(request['method'],request['path'],body=payload,headers={**headers,'Content-Type':'application/json','Connection':'close'});response=conn.getresponse();status=response.status
            all_headers=response.getheaders();require(sum(len(k)+len(v)+4 for k,v in all_headers)<=32768,'RESPONSE_HEADERS_TOO_LARGE');response_headers={k.lower():v for k,v in all_headers if k.lower() in ('content-type','retry-after','etag','x-ratelimit-remaining')};require(not 300<=status<400,'REDIRECT_FORBIDDEN')
            raw=response.read(2*1024**2+1);count=len(raw);require(count<=2*1024**2,'RESPONSE_TOO_LARGE');expected=response.getheader('content-length');require(expected is None or request['method']=='HEAD' or int(expected)==count,'RESPONSE_INCOMPLETE');response_digest=hashlib.sha256(raw).hexdigest();self.output_bytes+=count;require(self.output_bytes<=self.m['maxBytes'],'OUTPUT_BUDGET');complete=True
            if raw:
                try:body=json.loads(raw)
                except (ValueError,UnicodeError):body=None
            self.completed+=1
        except Exception as exc:error=str(exc) if isinstance(exc,RuntimeError) else 'HTTP_TIMEOUT' if isinstance(exc,(TimeoutError,socket.timeout)) else 'HTTP_TRANSPORT_ERROR'
        finally:
            if conn:conn.close()
        result=dict(node=request['node'],sequence=sequence,requestDigest=digest(request),bodyDigest=request['bodyDigest'],state='response-recorded' if complete else 'effect-unknown',status=status,headers=response_headers,bytes=count,responseDigest=response_digest,durationMs=(time.monotonic()-started)*1000,complete=complete,error=error,dispatchedAt=at,selected={})
        if complete:result['body']=body
        self.evidence[request['node']]=result;emit(dict(type='result',sessionId=self.session,evidence=result));return result
    def run(self):
        threading.Thread(target=self.listen,daemon=True).start()
        def watchdog():
            while not self.stop.wait(.05):
                if time.time()>=self.deadline or time.monotonic()>=self.monotonic_deadline:self.stop.set();break
                if self.m['mode'] in ('load','mock-only') and self.last_authorized and time.monotonic()-self.last_authorized>=2:self.stop.set();break
        threading.Thread(target=watchdog,daemon=True).start();error=None
        try:
            if self.m['mock']:self.mock()
            emit(dict(type='ready',sessionId=self.session,bootId=open('/proc/sys/kernel/random/boot_id').read().strip(),pid=os.getpid(),startTicks=open('/proc/self/stat').read().rsplit(') ',1)[1].split()[19],port=self.port))
            if self.m['mode']=='mock-only':
                grant,created=self.authorize('heartbeat',0,[]);self.last_authorized=created
                while not self.stop.wait(.1):
                    self.alive()
                    if time.monotonic()-self.last_authorized>=.9:grant,created=self.authorize('heartbeat',0,[]);self.last_authorized=created
            else:
                nodes=self.m['scenario']['nodes'];order=[]
                while len(order)<len(nodes):
                    ready=[n for n in nodes if n['id'] not in order and all(d in order for d in n['after'])];require(ready,'SCENARIO_CYCLE');order.extend(n['id'] for n in ready)
                ordered=[next(n for n in nodes if n['id']==key) for key in order]
                if self.m['mode']=='load':
                    require(all(not n['bindings'] and 'condition' not in n for n in nodes),'LOAD_DYNAMIC_FORBIDDEN');requests=[self.request(ordered[i%len(ordered)]) for i in range(self.m['maxRequests'])];grant,created=self.authorize('batch',0,requests);self.last_authorized=created
                else:requests=None
                next_at=time.monotonic()+1/self.m['rate']
                for seq in range(self.m['maxRequests'] if requests else len(ordered)):
                    self.alive();node=ordered[seq%len(ordered)]
                    if 'condition' in node and self.evidence.get(node['condition']['node'],{}).get('status')!=node['condition']['status']:continue
                    request=requests[seq] if requests else self.request(node)
                    # 空桶不积攒额度；等待时仍核对截止与模拟授权。 Empty token bucket never accumulates a burst.
                    while time.monotonic()<next_at:
                        self.alive()
                        if requests and time.monotonic()-self.last_authorized>=.9:grant,created=self.authorize('heartbeat',seq,[]);self.last_authorized=created
                        self.stop.wait(min(.1,max(0,next_at-time.monotonic())))
                    if requests:
                        if time.monotonic()-self.last_authorized>=.9:grant,created=self.authorize('heartbeat',seq,[]);self.last_authorized=created
                        require(time.monotonic()-self.last_authorized<2,'AUTHORIZATION_EXPIRED')
                        self.alive();require(time.monotonic()-self.last_authorized<2,'AUTHORIZATION_EXPIRED')
                    else:grant,created=self.authorize('permit',seq,[request]);require(time.monotonic()-created<2,'PERMIT_EXPIRED');self.last_authorized=created
                    next_at=time.monotonic()+1/self.m['rate']
                    result=self.send(request,seq,grant.get('secretHeaders',{}))
                    if not result['complete'] and not requests:break
        except Exception as exc:error=str(exc) if isinstance(exc,RuntimeError) else 'WORKER_FAILED'
        finally:
            self.stop.set()
            if self.server:self.server.shutdown();self.server.server_close()
            self.sock.close()
            try:os.unlink(self.sockpath)
            except FileNotFoundError:pass
            emit(dict(type='finished',sessionId=self.session,dispatched=self.dispatched,completed=self.completed,intervalsMs=self.intervals,error=error,listenerClosed=True))

if __name__=='__main__':
    if len(sys.argv)==3 and sys.argv[1]=='control':control(sys.argv[2])
    else:
        require(len(sys.argv)==2,'USAGE');data=open(sys.argv[1],'rb').read(32*1024**2+1);require(len(data)<=32*1024**2,'MANIFEST_TOO_LARGE');Engine(json.loads(data)).run()
