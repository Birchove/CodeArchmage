def outer():
    def inner():
        foo()

    inner()
