"""Listener mínimo na porta 80 que redireciona tudo para HTTPS na mesma máquina.

Existe porque o uvicorn escuta UMA porta só: o deploy sobe o app em 443 com TLS,
e este processo cobre a 80 — senão quem digitar "meuhost" no browser (que assume
http:// quando você não escreve o esquema) cai num connection refused e conclui
que o servidor está fora do ar.

Redireciona para o MESMO Host da requisição, apenas trocando o esquema e
removendo a porta. Assim funciona igual para "meuhost", "meuhost.tailnet.ts.net" e
um IP de LAN, sem precisar saber aqui dentro qual é o nome canônico da máquina —
e sem quebrar quando o Bruno renomear o host no Tailscale.

301 (permanente) e não 302: enquanto o deploy for este, o destino não muda, e o
cache do browser economiza um round-trip por acesso. Nenhum corpo de resposta é
enviado — todo browser segue o Location sozinho, e um corpo aqui só serviria
para vazar informação de servidor para quem varre a porta 80.

Roda com a stdlib pura (http.server), sem dependência nenhuma: precisa
sobreviver mesmo que o venv do backend esteja quebrado, porque a mensagem de
erro que ele produziria já é mais útil que um connection refused mudo.
"""

from __future__ import annotations

import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _https_target(host_header: str | None, path: str) -> str | None:
    """Monta a URL https de destino a partir do Host da requisição.

    Devolve None quando não há Host utilizável — nesse caso o chamador responde
    400 em vez de adivinhar um destino. Requisição HTTP/1.1 sem Host é inválida
    por spec, e chutar um hostname aqui produziria um redirect para o lugar
    errado (pior que um erro explícito).

    A porta é descartada de propósito: o Host de uma requisição na 80 vem como
    "meuhost" ou "meuhost:80", e o destino é sempre a 443 (implícita em https://).
    Formato IPv6 com colchetes ("[::1]:80") é tratado separadamente porque tem
    ":" dentro do próprio literal do endereço.
    """
    if not host_header:
        return None

    host = host_header.strip()
    if host.startswith("["):
        # IPv6: só o que vem DEPOIS do "]" pode ser porta.
        fim = host.find("]")
        if fim == -1:
            return None
        host = host[: fim + 1]
    elif ":" in host:
        host = host.split(":", 1)[0]

    if not host:
        return None
    return f"https://{host}{path}"


class _RedirectHandler(BaseHTTPRequestHandler):
    # HTTP/1.1 sem manter conexão viva: este processo existe para dizer "vá para
    # https" e sair do caminho. Keep-alive aqui só seguraria sockets de bots que
    # varrem a porta 80.
    protocol_version = "HTTP/1.0"
    server_version = "TaskNexusRedirect/1.0"

    def _redirect(self, com_corpo: bool) -> None:
        destino = _https_target(self.headers.get("Host"), self.path)
        if destino is None:
            self.send_error(400, "Missing or invalid Host header")
            return
        self.send_response(301)
        self.send_header("Location", destino)
        self.send_header("Content-Length", "0")
        self.end_headers()

    # Todo método vira o mesmo redirect. Um 301 em resposta a POST/PUT é
    # tecnicamente impreciso (o browser pode trocar o método para GET ao
    # seguir), mas nenhuma escrita real deveria chegar na porta 80: o app é
    # servido inteiro por https, e um POST aqui só acontece se alguém montou a
    # URL à mão. Redirecionar é mais útil que recusar.
    do_GET = lambda self: self._redirect(True)       # noqa: E731
    do_HEAD = lambda self: self._redirect(False)     # noqa: E731
    do_POST = lambda self: self._redirect(True)      # noqa: E731
    do_PUT = lambda self: self._redirect(True)       # noqa: E731
    do_PATCH = lambda self: self._redirect(True)     # noqa: E731
    do_DELETE = lambda self: self._redirect(True)    # noqa: E731
    do_OPTIONS = lambda self: self._redirect(False)  # noqa: E731

    def log_message(self, format: str, *args) -> None:
        """Silencia o log por requisição.

        A porta 80 aberta na internet/tailnet recebe varredura constante de bot;
        logar cada uma encheria o uvicorn.log de ruído e afogaria os logs do app
        de verdade, que é o que interessa no arquivo compartilhado.
        """
        return


def main() -> int:
    porta = int(sys.argv[1]) if len(sys.argv) > 1 else 80
    endereco = sys.argv[2] if len(sys.argv) > 2 else "0.0.0.0"
    try:
        servidor = ThreadingHTTPServer((endereco, porta), _RedirectHandler)
    except OSError as e:
        # Não é fatal para o deploy: o app em 443 funciona sem isso. Só perde a
        # conveniência de digitar o host sem esquema. Mensagem em stderr e exit
        # != 0 para o deploy.ps1 avisar sem abortar.
        print(f"[redirect] nao consegui escutar em {endereco}:{porta}: {e}", file=sys.stderr)
        return 1
    print(f"[redirect] {endereco}:{porta} -> https (301)", flush=True)
    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        servidor.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
