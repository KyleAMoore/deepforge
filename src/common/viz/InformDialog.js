/* globals define, $*/
define([
], function(
) {

    const InformDialog = function(title, body) {
        this.$el = this.createElement(title, body);
        this.$ok = this.$el.find('.btn-primary');
    };

    InformDialog.prototype.createElement = function(title, body) {
        const html = `<div class="modal" tabindex="-1" role="dialog">
          <div class="modal-dialog" role="document">
            <div class="modal-content">
              <div class="modal-header">
                <h3 class="modal-title">${title}</h3>
              </div>
              <div class="modal-body">
                <p>${body}</p>
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-save btn-primary" data-dismiss="modal">OK</button>
              </div>
            </div>
          </div>
        </div>`;
        return $(html);
    };

    InformDialog.prototype.show = function() {
        return new Promise(resolve => {
            this.$ok.on('click', () => resolve());
            this.$el.modal('show');
            this.$el.on('hidden.bs.modal', () => resolve());
        });
    };

    return InformDialog;
});
