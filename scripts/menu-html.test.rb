# Teste da tag do menu "Pedidos de hoje", rodado na imagem do Chatwoot (Ruby + minitest):
#   docker run --rm -v "$PWD/scripts:/s:ro" --entrypoint ruby chatwoot/chatwoot:<versão> /s/menu-html.test.rb
# O npm test chama este arquivo quando o Docker está disponível (tests/canal/menu-html.test.ts).
require 'minitest/autorun'
require_relative 'menu-html'

class MenuHtmlTest < Minitest::Test
  def test_monta_a_tag_com_o_token_num_atributo
    assert_equal '<script src="http://127.0.0.1:3001/painel/menu.js" data-token="abc_DEF-123" defer></script>',
                 html_do_menu('http://127.0.0.1:3001', 'abc_DEF-123')
  end

  def test_escapa_o_token_para_nada_virar_html
    html = html_do_menu('http://127.0.0.1:3001/', %q(x"><img src=x onerror=alert(1)>))
    refute_includes html, '<img'
    assert_includes html, 'data-token="x&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"'
  end

  def test_porta_padrao_some_do_endereco
    assert_includes html_do_menu('https://painel.local:443/x', 't'), 'src="https://painel.local/painel/menu.js"'
  end

  def test_so_aceita_http_ou_https
    assert_raises(RuntimeError) { html_do_menu('javascript:alert(1)', 't') }
    assert_raises(RuntimeError) { html_do_menu('file:///etc/passwd', 't') }
  end
end
