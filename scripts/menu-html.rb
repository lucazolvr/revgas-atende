# Tag que põe o item "Pedidos de hoje" no menu lateral do Chatwoot (usada pelo aplicar-menu.rb).
# Separada do resto para ser testada sem banco: scripts/menu-html.test.rb.
require 'erb'
require 'uri'

# O token vai num atributo, escapado: nada do .env pode virar HTML dentro do Chatwoot.
def html_do_menu(url_painel, token)
  uri = URI.parse(url_painel)
  raise 'PAINEL_URL precisa ser http(s)' unless %w[http https].include?(uri.scheme) && uri.host
  porta = uri.port == uri.default_port ? '' : ":#{uri.port}"
  src = "#{uri.scheme}://#{uri.host}#{porta}/painel/menu.js"
  %(<script src="#{ERB::Util.html_escape(src)}" data-token="#{ERB::Util.html_escape(token)}" defer></script>)
end
