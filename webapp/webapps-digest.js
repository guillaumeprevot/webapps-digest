function Digest(files, digest, callback, progress) {
	if (!files || files.length == 0)
		return;

	var reader = new FileReader(),
		sliceSize, // number of bytes FileReader will read on each loop
		chunksize, // number of bytes Forge will digest on each loop
		totalSize = 0,
		doneSize = 0,
		fileIndex = 0,
		fileOffset;

	// sliceSize is the number of bytes each FileReader.read*** call will load.
	// It only depends on available memory so 10MB seems OK
	sliceSize = 64 * 1024;//10 * 1024 * 1024;

	// chunkSize, is the number of bytes each Forge digest call can use.
	// The method uses String.fromCharCode.apply(...) and thus, chunkSize is limited to the number of arguments.
	// Too large values would throw : "RangeError: arguments array passed to Function.prototype.apply is too large"
	// 64Ko seems OK on different browsers
	chunksize = 64 * 1024;

	// totalSize is the cumulative size of all files.
	// This is used to show progress
	$.each(files, function(index, file) {
		totalSize += file.size;
	});

	function digestResult(event) {
		// event.target.result est :
		// - readAsDataURL: une chaine du type "data:text/plain;base64,dGVzdA0KYWJjDQojgCE="
		// - readAsArrayBuffer : un ArrayBuffer
		// - readAsBinaryString : une chaine binaire (pas très lisible)
		// - readAsText : une chaine (UTF-8 par défaut mais readAsText a un 2ème param)

		// Digest a large "buffer" into smaller "chunks"
		var buffer = event.target.result,
			array = new Uint8Array(buffer);
		for (var i = 0; i < array.length; i += chunksize) {
			// Digest chunk
			var chunk = array.slice(i, i + chunksize);
			//digest.update(forge.util.binary.raw.encode(chunk));
			digest.update(String.fromCharCode.apply(null, chunk));
			// Update progress
			doneSize += chunk.length;
			if (progress)
				progress.onprogress(doneSize, totalSize, chunk.length) 
		}
		// Move forward
		fileOffset += sliceSize;
		if (fileOffset < files[fileIndex].size)
			digestNextChunk();
		else {
			var value = digest.digest().toHex();
			callback(files[fileIndex], value);
			fileIndex++;
			if (fileIndex < files.length)
				digestNextFile();
			else {
				// DONE !
				if (progress)
					progress.onstop();
			}
		}
	}

	function digestNextChunk() {
		var chunk = files[fileIndex].slice(fileOffset, fileOffset + sliceSize);
		reader.readAsArrayBuffer(chunk);
	}

	function digestNextFile() {
		digest.start();
		fileOffset = 0;
		digestNextChunk();
	}

	reader.onload = digestResult;
	if (progress)
		progress.onstart();
	digestNextFile();
}

/**
 * Classe responsable de l'affichage de la progression.
 * 
 * NB : on n'utilise pas les classes de Bootstrap "progress" et "progress-bar" car le dessin fait perdre un temps non négligeable (par exemple : 8.8s -> 10.8s).
 * Si toutefois on le voulait, il suffirait d'ajouter les classes aux 2 div et de retirer le style dans la feuille CSS.
 */
function Progress(progressBar) {
	var progressPct, progressInterval;
	function refresh() {
		progressBar.attr('aria-valuenow', progressPct.toFixed(0)).css('width', progressPct + '%').html('&nbsp;' + progressPct.toFixed(0) + '%');
	}
	this.onstart = function() {
		progressBar.attr('aria-valuenow', '0').css('width', '0').html('');
		progressBar.parent().show();
		progressPct = 0;
		progressInterval = setInterval(refresh, 200);
	};
	this.onprogress = function(done, total, step) {
		progressPct = done * 100.0 / total;
	};
	this.onstop = function() {
		clearInterval(progressInterval);
		progressInterval = undefined;
		progressPct = undefined;
		progressBar.parent().hide();
	};
}

$(function() {
	var digestAlgorithms = [];
	digestAlgorithms.push({name: 'md5', title: 'MD5'});
	digestAlgorithms.push({name: 'sha1', title: 'SHA-1', isDefault: true });
	digestAlgorithms.push({name: 'sha256', title: 'SHA-256'});
	digestAlgorithms.push({name: 'sha384', title: 'SHA-384'});
	digestAlgorithms.push({name: 'sha512', title: 'SHA-512'});

	$('#digest-type-select').append($.map(digestAlgorithms, function(digest, index) {
		return $('<option />').attr('value', digest.name).text(digest.title).prop('selected', digest.isDefault)[0];
	})).multiselect({
		buttonClass: 'btn btn-primary'
	}).on('change', function() {
		$('#digest-table tbody').empty().parent().hide();
		$('#digest-files-input').trigger('change');
	});

	$('#digest-files-button').on('click', function() {
		$('#digest-files-input').click();
	});

	$('#digest-files-input').on('change', function() {
		digestFiles(this.files);
	});

	$('body').on('dragover', function(event) {
		event.stopPropagation();
		event.preventDefault();
		event.originalEvent.dataTransfer.dropEffect = 'copy';
	}).on('drop', function(event) {
		event.stopPropagation();
		event.preventDefault();
		digestFiles(event.originalEvent.dataTransfer.files);
	});

	$('#digest-compare-input').on('change', function() {
		var compareValue = this.value;
		$('#digest-table > tbody > tr > td:first-child').each(function(index) {
			$(this).parent().toggleClass('success', this.innerHTML === compareValue);
		});
	}).on('focus', function() {
		$('.multiselect, #digest-files-button, #digest-download-button, #digest-clear-button').fadeOut('fast', function() {
			$('#digest-compare-input').css('width', '100%');
		});
	}).on('blur', function() {
		$('#digest-compare-input').css('width', 'initial');
		$('.multiselect, #digest-files-button, #digest-download-button, #digest-clear-button').fadeIn();
	});

	$('#digest-download-button').on('click', function() {
		var text = $('#digest-table tbody tr').map(function(index) {
			var cells = $(this).children();
			return cells[0].innerHTML + '\t' + cells[1].innerHTML;
		}).get().join('\n');

		$(this).attr('download', 'CHECKUMS.' + $('#digest-type-select').val())
			.attr('href', 'data:text/plain;base64,' + forge.util.encode64(text));
	});

	$('#digest-clear-button').on('click', function() {
		$('#digest-table tbody').empty().parent().hide();
	});

	function digestFiles(files) {
		var tbody = $('#digest-table').show().children('tbody'),
			progressBar = $('#digest-progress').children(),
			algorithm = $('#digest-type-select').val(),
			compareValue = $('#digest-compare-input').val(),
			digest = forge.md[algorithm].create();

		new Digest(files, digest, function(file, hash) {
				$('<tr />')
					.toggleClass('success', hash === compareValue)
					.append('<td>' + hash + '</td>')
					.append('<td>' + file.name + '</td>')
					.appendTo(tbody);
		}, new Progress(progressBar));
	}

});