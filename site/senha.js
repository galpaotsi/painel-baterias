/* Tranca simples do painel de bancos de bateria.
 *
 * HONESTIDADE SOBRE O QUE ISSO E:
 * Site estatico nao tem servidor, entao a conferencia acontece no navegador.
 * Quem abrir o codigo-fonte acha a senha. Isso e TRANCA DE PORTA, nao cofre --
 * serve pra alguem que topou com o link nao entrar sem querer, e nada alem
 * disso. Foi decisao explicita: o controle de bancos de bateria nao e sigiloso.
 *
 * Se um dia precisar de barreira de verdade, o caminho e Cloudflare Access
 * (gratis ate 50 pessoas, login por e-mail) -- ai a checagem sai do navegador.
 *
 * Pra trocar a senha: rode no console do navegador  btoa('novasenha')
 * e cole o resultado em SENHA abaixo.
 *
 * Nao uso crypto.subtle de proposito: ele nao existe em file://, e o site
 * precisa funcionar tanto com duplo clique quanto publicado.
 */
(function () {
  'use strict';

  var SENHA = 'Z2FscGFvdHNp';           // base64
  var CHAVE = 'painel-baterias-liberado';

  function liberar() {
    document.documentElement.setAttribute('data-liberado', '1');
    var t = document.getElementById('tranca');
    if (t) t.remove();
  }

  var jaLiberado = false;
  try {
    jaLiberado = localStorage.getItem(CHAVE) === SENHA;
  } catch (_) { /* storage bloqueado: pede a senha toda vez */ }

  if (jaLiberado) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', liberar);
    } else {
      liberar();
    }
    return;
  }

  function montar() {
    var box = document.createElement('div');
    box.id = 'tranca';
    box.innerHTML = ''
      + '<form id="tranca-form" autocomplete="off">'
      +   '<div class="tranca-marca">Controle de Bancos de Bateria'
      +     '<small>Icatel Telemática · Laboratório</small>'
      +   '</div>'
      +   '<label for="tranca-campo">Senha de acesso</label>'
      +   '<input id="tranca-campo" type="password" autocomplete="current-password" spellcheck="false">'
      +   '<button type="submit">Entrar</button>'
      +   '<p id="tranca-erro" role="alert"></p>'
      + '</form>';
    document.body.appendChild(box);

    var form = document.getElementById('tranca-form');
    var campo = document.getElementById('tranca-campo');
    var erro = document.getElementById('tranca-erro');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var tentativa;
      try {
        tentativa = btoa(campo.value);
      } catch (_) {
        tentativa = '';                  // caractere fora de latin-1
      }
      if (tentativa === SENHA) {
        try { localStorage.setItem(CHAVE, SENHA); } catch (_) {}
        liberar();
      } else {
        erro.textContent = 'Senha incorreta.';
        campo.value = '';
        campo.focus();
        box.classList.remove('treme');
        void box.offsetWidth;            // reinicia a animacao
        box.classList.add('treme');
      }
    });

    campo.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', montar);
  } else {
    montar();
  }
})();
